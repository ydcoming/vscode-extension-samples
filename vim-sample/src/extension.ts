/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as vscode from 'vscode';

import {Words} from './words';
import {MotionState, Motion, Motions} from './motions';
import {Operator, Operators} from './operators';
import {Mode, IController} from './common';
import {Mappings} from './mappings';
import {Controller} from './controller';

export function activate(context: vscode.ExtensionContext) {
	function registerCommandNice(commandId:string, run:(...args:any[])=>void): void {
		context.subscriptions.push(vscode.commands.registerCommand(commandId, run));
	}

	let vimExt = new VimExt();

	registerCommandNice('type', function(args) {
		if (!vscode.window.activeTextEditor) {
			return;
		}
		vimExt.type(args.text);
	});
	registerCommandNice('replacePreviousChar', function(args) {
		if (!vscode.window.activeTextEditor) {
			return;
		}
		vimExt.replacePrevChar(args.text, args.replaceCharCnt);
	});
	registerCommandNice('vim.goToNormalMode', function(args) {
		vimExt.goToNormalMode();
	});
	registerCommandNice('vim.clearInput', function(args) {
		vimExt.clearInput();
	});
	// registerCommandNice('paste', function(args) {
	// 	console.log('paste with: ', args.text, args.pasteOnNewLine);
	// });
	// registerCommandNice('cut', function(args) {
	// 	console.log('cut (no args)');
	// });
}

export function deactivate() {
	// Everything is nicely registered in context.subscriptions,
	// so nothing to do for now.
}

function getConfiguredWordSeparators(): string {
	let editorConfig = vscode.workspace.getConfiguration('editor');
	return editorConfig['wordSeparators'];
}

class VimExt {

	private _inNormalMode: ContextKey;
	private _hasInput: ContextKey;
	private _statusBar: StatusBar;
	private _controller: Controller;

	constructor() {
		this._inNormalMode = new ContextKey('vim.inNormalMode');
		this._hasInput = new ContextKey('vim.hasInput');
		this._statusBar = new StatusBar();

		this._controller = new Controller()

		vscode.window.onDidChangeActiveTextEditor((textEditor) => {
			if (!textEditor) {
				return;
			}
			this._ensureState();
		});

		vscode.window.onDidChangeTextEditorSelection((e) => {
			let isVisual = this._controller.getVisual();

			if (!isVisual) {
				// a selection in the editor brings us to visual mode
				let goToVisualMode = false;

				if (e.selections.length > 1) {
					goToVisualMode = true;
				} else {
					goToVisualMode = !e.selections[0].isEmpty;
				}

				if (goToVisualMode) {
					this._controller.setVisual(true);
				}
			} else {
				// a collapsed selection in the editor brings us to normal mode
				let leaveVisualMode = false;
				if (e.selections.length === 1) {
					leaveVisualMode = e.selections[0].isEmpty;
				}
				if (leaveVisualMode) {
					this._controller.setVisual(false);
				}
			}

			this._ensureState();
		});

		var ensureConfig = () => {
			this._controller.setWordSeparators(getConfiguredWordSeparators());
		};
		ensureConfig();
		vscode.workspace.onDidChangeConfiguration(ensureConfig);

		this._ensureState();
	}

	public goToNormalMode(): void {
		this._controller.setMode(Mode.NORMAL);
		this._ensureState();
	}

	public clearInput(): void {
		this._controller.clearInput();
		this._ensureState();
	}

	public type(text: string): void {
		let r = this._controller.type(vscode.window.activeTextEditor, text).then(
			(r) => {
				if (r.hasConsumedInput) {
					this._ensureState();
					if (r.executeEditorCommand) {
						let args = [r.executeEditorCommand.commandId];
						args = args.concat(r.executeEditorCommand.args);
						vscode.commands.executeCommand.apply(this, args);
					}
					return;
				}
				vscode.commands.executeCommand('default:type', {
					text: text
				});
			}
		);
	}

	public replacePrevChar(text: string, replaceCharCnt: number): void {
		if (this._controller.replacePrevChar(vscode.window.activeTextEditor, text, replaceCharCnt)) {
			this._ensureState();
			return;
		}
		vscode.commands.executeCommand('default:replacePreviousChar', {
			text: text,
			replaceCharCnt: replaceCharCnt
		});
	}

	private _ensureState(): void {
		// 0. position
		this._ensurePosition();

		// 1. status bar
		this._statusBar.setText(this._controller.getStatusText());

		// 2. cursor style
		this._ensureCursorStyle(this._controller.getCursorStyle());

		// 3. context: vim.inNormalMode
		this._inNormalMode.set(this._controller.getMode() === Mode.NORMAL);

		// 4. context: vim.hasInput
		this._hasInput.set(this._controller.hasInput());
	}

	private _ensurePosition(): void {
		if (!vscode.window.activeTextEditor) {
			return;
		}
		this._controller.ensureNormalModePosition(vscode.window.activeTextEditor);
	}

	private _ensureCursorStyle(cursorStyle: vscode.TextEditorCursorStyle): void {
		if (!vscode.window.activeTextEditor) {
			return;
		}
		let currentCursorStyle = vscode.window.activeTextEditor.options.cursorStyle;
		if (currentCursorStyle !== cursorStyle) {
			vscode.window.activeTextEditor.options = {
				cursorStyle: cursorStyle
			};
		}
	}
}

class ContextKey {
	private _name: string;
	private _lastValue: boolean;

	constructor(name:string) {
		this._name = name;
	}

	public set(value:boolean): void {
		if (this._lastValue === value) {
			return;
		}
		this._lastValue = value;
		vscode.commands.executeCommand('setContext', this._name, this._lastValue);
	}
}

class StatusBar {
	private _actual: vscode.StatusBarItem;
	private _lastText: string;

	constructor() {
		this._actual = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
		this._actual.show();
	}

	public setText(text:string): void {
		if (this._lastText === text) {
			return;
		}
		this._lastText = text;
		this._actual.text = this._lastText;
	}
}
