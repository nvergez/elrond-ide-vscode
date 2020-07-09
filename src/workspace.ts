import * as vscode from "vscode";
import path = require("path");
import fs = require("fs");
import { Feedback } from "./feedback";
import { MySettings } from "./settings";
import _ = require('underscore');
import * as presenter from "./presenter";
import * as errors from './errors';
import glob = require("glob");


export function isOpen(): boolean {
    return getPath() ? true : false;
}

export function getPath() {
    let folders = vscode.workspace.workspaceFolders;
    let workspaceFolder: vscode.WorkspaceFolder = folders ? folders[0] : null;

    if (workspaceFolder) {
        return workspaceFolder.uri.fsPath;
    } else {
        throw new errors.MyError({ Message: "Workspace not available." });
    }
}

export async function setup() {
    ensureFolder(".vscode");
    ensureWorkspaceDefinitionFile();
    await patchSettings();
}


function ensureFolder(folderName: string) {
    let folderPath = path.join(getPath(), folderName);
    if (fs.existsSync(folderPath)) {
        return;
    }

    fs.mkdirSync(folderPath);
}

function ensureWorkspaceDefinitionFile() {
    let filePath = path.join(getPath(), "elrond.workspace.json");
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "{}");
    }
}

async function patchSettings(): Promise<boolean> {
    let filePath = path.join(getPath(), ".vscode", "settings.json");
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "{}");
    }

    let json = fs.readFileSync(filePath, { encoding: "utf8" });
    let settings = JSON.parse(json);
    let sdkPath = path.join("${env:HOME}", MySettings.getElrondSdkRelativeToHome());
    let erdpyEnvFolder = path.join(sdkPath, "erdpy-venv");
    let erdpyBinFolder = path.join(erdpyEnvFolder, "bin");
    let arwentoolsFolder = path.join(sdkPath, "arwentools");
    let rustFolder = path.join(sdkPath, "vendor-rust");
    let rustBinFolder = path.join(rustFolder, "bin");

    let env: any = {
        "PYTHONHOME": null,
        "PATH": rustBinFolder + ":" + erdpyBinFolder + ":" + arwentoolsFolder + ":" + "${env:PATH}",
        "VIRTUAL_ENV": erdpyEnvFolder,
        "RUSTUP_HOME": rustFolder,
        "CARGO_HOME": rustFolder
    };

    let patch = {
        "terminal.integrated.env.linux": env,
        "terminal.integrated.env.osx": env,
        "terminal.integrated.environmentChangesIndicator": "on",
        "terminal.integrated.inheritEnv": true,
        "workbench.dialogs.customEnabled": true
    };

    let patched = false;
    for (const [key, value] of Object.entries(patch)) {
        if (!_.isEqual(settings[key], value)) {
            settings[key] = value;
            patched = true;
        }
    }

    if (!patched) {
        return false;
    }

    let allow = await presenter.askModifySettings();
    if (!allow) {
        return false;
    }

    let content = JSON.stringify(settings, null, 4);
    fs.writeFileSync(filePath, content);
    Feedback.info("Updated settings.json.");

    return true;
}

export function guardIsOpen(): boolean {
    if (!isOpen()) {
        Feedback.infoModal("No folder open in your workspace. Please open a folder.");
        return false;
    }

    return true;
}

export async function patchLaunchAndTasks() {
    let launchPath = path.join(getPath(), ".vscode", "launch.json");
    if (!fs.existsSync(launchPath)) {
        fs.writeFileSync(launchPath, `{
    "version": "0.2.0",
    "configurations": []
}`);
    }

    let tasksPath = path.join(getPath(), ".vscode", "tasks.json");
    if (!fs.existsSync(tasksPath)) {
        fs.writeFileSync(tasksPath, `{
    "version": "2.0.0",
    "tasks": []
}`);
    }

    let launchObject = JSON.parse(fs.readFileSync(launchPath, { encoding: "utf8" }));
    let tasksObject = JSON.parse(fs.readFileSync(tasksPath, { encoding: "utf8" }));
    let launchItems: any[] = launchObject["configurations"];
    let tasksItems: any[] = tasksObject["tasks"];
    let patched = false;

    let metadataObjects = getMetadataObjects();

    metadataObjects.forEach(metadata => {
        let project = metadata.ProjectName;
        let projectPath = metadata.ProjectPathInWorkspace;
        let language = metadata.Language;
        if (language == "rust") {
            let debugProject: any = {
                "type": "lldb",
                "request": "launch",
                "name": `Debug ${project}`,
                "preLaunchTask": `${project}-debug-build`,
                "program": "${workspaceFolder}/" + `${projectPath}/debug/target/debug/${project}-debug`,
                "args": [],
                "cwd": "${workspaceFolder}"
            };

            let buildTask: any = {
                "label": `${project}-debug-build`,
                "command": "cargo",
                "args": ["build"],
                "options": {
                    "cwd": "${workspaceFolder}/" + `${projectPath}/debug`
                },
                "type": "shell"
            };

            let debugProjectExists = launchItems.find(item => item.name == debugProject.name) ? true : false;
            let buildTaskExists = tasksItems.find(item => item.label == buildTask.label) ? true : false;

            if (!debugProjectExists || !buildTaskExists) {
                launchItems.push(debugProject);
                tasksObject["tasks"].push(buildTask);
                patched = true;
            }
        }
    });

    if (!patched) {
        return false;
    }

    let allow = await presenter.askModifyLaunchAndTasks();
    if (!allow) {
        return false;
    }

    fs.writeFileSync(launchPath, JSON.stringify(launchObject, null, 4));
    fs.writeFileSync(tasksPath, JSON.stringify(tasksObject, null, 4));
    Feedback.info("Updated launch.json and tasks.json.");
}

export function getLanguages() {
    let metadataObjects = getMetadataObjects();
    let languages = metadataObjects.map(item => item.Language);
    languages = _.uniq(languages);
    return languages;
}

export function getMetadataObjects(): ProjectMetadata[] {
    let pattern = `${getPath()}/**/elrond.json`;
    let paths = glob.sync(pattern, {});
    let result: ProjectMetadata[] = [];

    paths.forEach(item => {
        try {
            result.push(new ProjectMetadata(item));
        } catch {
            Feedback.error(`Could not read metadata for ${item}.`);
        }
    });

    return result;
}

export function getMetadataObjectByFolder(folder: string): ProjectMetadata {
    let metadataPath = path.join(folder, "elrond.json");
    return new ProjectMetadata(metadataPath);
}

export class ProjectMetadata {
    Path: string;
    ProjectPath: string;
    ProjectPathInWorkspace: string;
    ProjectName: string;
    Language: string;

    constructor(metadataFile: string) {
        let json = fs.readFileSync(metadataFile, { encoding: "utf8" });
        let parsed = JSON.parse(json);

        this.Path = metadataFile;
        this.Language = parsed.language;
        this.ProjectPath = path.dirname(metadataFile);
        this.ProjectPathInWorkspace = this.ProjectPath.replace(getPath(), "");
        this.ProjectName = path.basename(this.ProjectPath);
    }
}