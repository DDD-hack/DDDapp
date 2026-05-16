import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  console.log("DDD extension activated");

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = "$(heart) DDD";
  statusBar.tooltip = "DDD: connected";
  statusBar.show();

  context.subscriptions.push(statusBar);
}

export function deactivate() {}
