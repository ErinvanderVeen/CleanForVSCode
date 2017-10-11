'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {
    TextDocument, Position, CancellationToken, ExtensionContext,CompletionItemProvider,CompletionItem,Hover,Range,
    languages,window,commands, MarkdownString, DiagnosticCollection, Diagnostic, DiagnosticSeverity,
    ShellExecution, Uri
} from 'vscode';
import {normalize, format, parse} from 'path'; 
import { askCloogle, askCloogleExact, getInterestingStringFrom } from './cloogle';
import { Let, Tuple, MakeList } from './tools';
import { cpm, getProjectPath } from './cpm';
import { spawn } from 'child_process';


class hey implements CompletionItemProvider {
    public async provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): Promise<CompletionItem[]> {
        return [new CompletionItem('hey')];
    }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {
    let computedTypes = {};
    
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "clean" is now active!');

    let inv = (s: string) => s.split('').reverse().join(''); 
    languages.registerHoverProvider('clean', {
        async provideHover(document, position, token) {
            let editor = window.activeTextEditor;    
            let regex = /([-~@#$%^?!+*<>\/|&=:.]+|(\w*`|\w+))/;
            let rangeVarName = editor.document.getWordRangeAtPosition(position, regex);
            let varName = editor.document.getText(rangeVarName);
            if(varName in computedTypes)
                return new Hover(computedTypes[varName]);
            else{
                let result = await askCloogleExact(varName);
                if(!result)
                    return;
                let [TypeData, [GeneralData, Specifics]] = result;

                if(GeneralData.builtin)
                if(GeneralData.builtin && TypeData != 'SyntaxResult')
                    return new Hover({value: ':: '+varName, language: 'clean'});
                
                let link = (line: number, icl=false) => 
                    `https://cloogle.org/src#${GeneralData.library}.${GeneralData.modul}${icl ? ';icl' : ''};line=${line}`;
                let head = new MarkdownString(
                    `[[+]](https://cloogle.org/#${encodeURI(varName)}) ${GeneralData.library}: ${GeneralData.modul} ([dcl:${GeneralData.dcl_line}](${link(GeneralData.dcl_line)}):[icl:${GeneralData.icl_line}](${link(GeneralData.icl_line, true)}))`
                );
                return new Hover([head, {value: getInterestingStringFrom(result), language: 'clean'}]);
                let listResults:string[] = Let(getInterestingStringFrom(result), t => t instanceof Array ? t : [t]);
                return new Hover([head, ...listResults.map(value => ({value, language: 'clean'}))]);
            }
        }
    });

    let regexpParseErrors = /^\s*(Warning|Type error|Error|Overloading .rror|Uniqueness .rror|Parse .rror) \[([\w\.]+),(\d+)(?:;(\d+))?(?:,([^,]*))?]:(.*)((\n\s.*)*)/mg;

    let newDiagnosticCollection = () => languages.createDiagnosticCollection('clean');
    let diagnostics = newDiagnosticCollection();
    
    languages.registerCompletionItemProvider('clean', new hey(), 'h');
    
    let lastOut;
    let cpmMake = async () => {
        let editor = window.activeTextEditor;
        
        let path = getProjectPath(parse(window.activeTextEditor.document.fileName).dir);
        if(path instanceof Error){
            window.showErrorMessage('Could not detect any *.prj file in any parent directories');
            return false;
        }

        diagnostics.clear();

        lastOut && lastOut.dispose();
        process.chdir(path);
        let out = window.createOutputChannel("CPM");
        lastOut = out;
        out.show();  
        let cpmResult = await cpm('essai', l => out.appendLine(l));
        
        if(cpmResult instanceof Error){
            window.showErrorMessage(cpmResult.message);
            return false;
        }
        // let outs = cpmResult.split(/\n(?=[^\s])/).filter(o => o);
        
        // let outs = cpmResult.match(new RegExp(regexpParseErrors.toString(), 'mg')) || [];
        // let types = outs.map(m => m.match(/^(\w*`?|[-~@#$%^?!+*<>\/|&=:.]+)\s*::\s*(.*)[\s\n]*$/)).filter(o => o);
        // types.forEach(([,n,t]) => computedTypes[n] = t);
        

        let errors = MakeList(() => Let(regexpParseErrors.exec(<string>cpmResult), value => ({ value, done: !value })))
                .filter(o => o)
                .map(([,errorName,fName,l,c,oth,msg,more,]) => Tuple(errorName,fName,l,c,oth,msg,(more||'').split('\n').map(o => o.trim())));
        
        
        let derrors = errors.map(([n,fName,l,c,,msg,more]) => Tuple(
            Uri.file(path+'/'+fName.replace(/\.(?=.{4})/g, '/')),
            [new Diagnostic(
                c!==undefined && (+c).toString() === c.toString() ?
                    new Range(new Position(+l, +c), new Position(+l, +c + 1))
                        :
                    new Range(new Position(+l-1, 0), new Position(+l, 0)),
                n+': '+msg+'\n'+(more||[]).join('\n')
                , n=='Warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error
            )]
        ));
        diagnostics.set(derrors);

        let executable = (cpmResult.match(/^Linking '(.*?)'$/m) || [])[1] || '';

        return {executable, out};
    };  
    let disposableCpmMake       = commands.registerCommand('extension.cpmMake', cpmMake);
    let disposableCpmMakeExec   = commands.registerCommand('extension.cpmMakeExec', async () => {
        let result = await cpmMake();

        if(result === false)
            return;
        
        // let s = new ShellExecution('bash.exe -c "'+result.executable+'"');
        // window.createTerminal('HEY', 'bash.exe');
        let out = result.out || window.createOutputChannel("Clean program");

        out.appendLine("Execute program "+result.executable+"...");
        out.show();
        let p = spawn('bash.exe', ['-c', './'+result.executable]);
        let left = '';
        p.stdout.on("data", (chunk) => {
            let s = chunk.toString();
            let i = s.lastIndexOf('\n');
            if(i > -1){
                out.appendLine(left + s.substr(0, i))
                left = s.substr(i + 1);
            }else
                left += s;
        });
        p.stdout.on("error", (err) => out.appendLine('ERROR: '+err.toString()));
        p.stdout.on("close", () => [left, ' ', 'Program done'].map(x => x && out.appendLine(x)))
    });

    context.subscriptions.push(disposableCpmMake);
    context.subscriptions.push(disposableCpmMakeExec);
}

// this method is called when your extension is deactivated
export function deactivate() {
}