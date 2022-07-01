import * as vscode from "vscode";
import { Root } from "./root";
import { Feedback } from "./feedback";
import * as sdk from "./sdk";
import {
  TemplatesViewModel as TemplatesViewModel,
  ContractTemplate,
} from "./templates";
import * as workspace from "./workspace";
import * as erdjsSnippets from "./erdjsSnippets";
import * as presenter from "./presenter";
import { Environment } from "./environment";
import * as errors from "./errors";
import * as snippets from "./snippets";
import { SmartContractsViewModel, SmartContract } from "./contracts";
import { Uri } from "vscode";
import path = require("path");

export async function activate(context: vscode.ExtensionContext) {
  Feedback.debug("ElrondIDE.activate()");

  Root.ExtensionContext = context;

  let templatesViewModel = new TemplatesViewModel();
  vscode.window.registerTreeDataProvider(
    "contractTemplates",
    templatesViewModel
  );
  let contractsViewModel = new SmartContractsViewModel();
  vscode.window.registerTreeDataProvider("smartContracts", contractsViewModel);

  vscode.commands.registerCommand("elrond.setupWorkspace", setupWorkspace);
  vscode.commands.registerCommand("elrond.installSdk", installSdk);
  vscode.commands.registerCommand("elrond.installSdkModule", installSdkModule);
  vscode.commands.registerCommand("elrond.gotoContract", gotoContract);
  vscode.commands.registerCommand("elrond.buildContract", buildContract);
  vscode.commands.registerCommand(
    "elrond.runContractSnippet",
    runContractSnippet
  );
  vscode.commands.registerCommand("elrond.runMandosTests", runMandosTests);
  vscode.commands.registerCommand("elrond.runFreshTestnet", runFreshTestnet);
  vscode.commands.registerCommand(
    "elrond.resumeExistingTestnet",
    resumeExistingTestnet
  );
  vscode.commands.registerCommand("elrond.stopTestnet", stopTestnet);

  vscode.commands.registerCommand("elrond.cleanContract", cleanContract);
  vscode.commands.registerCommand(
    "elrond.refreshTemplates",
    async () => await refreshViewModel(templatesViewModel)
  );
  vscode.commands.registerCommand("elrond.newFromTemplate", newFromTemplate);
  vscode.commands.registerCommand(
    "elrond.refreshContracts",
    async () => await refreshViewModel(contractsViewModel)
  );

  vscode.commands.registerCommand(
    "elrond.setupErdjsSnippets",
    setupErdjsSnippets
  );

  Environment.set();
}

export function deactivate() {
  Feedback.debug("ElrondIDE.deactivate()");
}

async function setupWorkspace() {
  if (!workspace.guardIsOpen()) {
    return;
  }

  Environment.set();
  await workspace.setup();
  await sdk.ensureInstalled();
  await workspace.patchLaunchAndTasks();
  await ensureInstalledBuildchains();
  await Feedback.infoModal("Workspace has been set up.");
}

async function installSdk() {
  try {
    await sdk.reinstall();
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function installSdkModule() {
  try {
    await sdk.reinstallModule();
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function refreshViewModel(viewModel: any) {
  try {
    await viewModel.refresh();
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function newFromTemplate(template: ContractTemplate) {
  try {
    let parentFolder = workspace.getPath();
    let templateName = template.name;
    let contractName = await presenter.askContractName();

    await sdk.newFromTemplate(parentFolder, templateName, contractName);
    await workspace.patchLaunchAndTasks();
    await ensureInstalledBuildchains();
    vscode.commands.executeCommand(
      "workbench.files.action.refreshFilesExplorer"
    );
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function gotoContract(contract: SmartContract) {
  try {
    let uri = Uri.file(contract.getMetadataPath());
    await vscode.commands.executeCommand("vscode.open", uri);
    await vscode.commands.executeCommand(
      "workbench.files.action.focusFilesExplorer"
    );
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function buildContract(contract: any) {
  try {
    let folder = getContractFolder(contract);
    await sdk.buildContract(folder);
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function cleanContract(contract: any) {
  try {
    let folder = getContractFolder(contract);
    await sdk.cleanContract(folder);
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function runContractSnippet(contract: any) {
  try {
    let folder = getContractFolder(contract);
    await snippets.runContractSnippet(folder);
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

function getContractFolder(contract: any): string {
  if (contract instanceof Uri) {
    let fsPath = contract.fsPath;
    if (fsPath.includes("elrond.json")) {
      return path.dirname(fsPath);
    } else if (fsPath.includes("snippets.sh")) {
      return path.dirname(fsPath);
    } else {
      return fsPath;
    }
  }

  return vscode.workspace.workspaceFolders[0].uri.path;
}

async function runMandosTests(item: any) {
  try {
    if (item instanceof Uri) {
      await sdk.runMandosTests(item.fsPath);
    } else {
      await sdk.runMandosTests((item as SmartContract).getPath());
    }
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function runFreshTestnet(testnetToml: Uri) {
  try {
    await sdk.runFreshTestnet(testnetToml);
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function resumeExistingTestnet(testnetToml: Uri) {
  try {
    await sdk.resumeExistingTestnet(testnetToml);
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function stopTestnet(testnetToml: Uri) {
  try {
    await sdk.stopTestnet(testnetToml);
  } catch (error) {
    errors.caughtTopLevel(error);
  }
}

async function ensureInstalledBuildchains() {
  let languages = workspace.getLanguages();
  await sdk.ensureInstalledBuildchains(languages);
}

async function setupErdjsSnippets() {
  let destinationFolder = await presenter.askOpenFolder(
    `Please select a destination for "erdjs-snippets":`
  );
  if (destinationFolder) {
    await erdjsSnippets.setup(destinationFolder);
  }
}
