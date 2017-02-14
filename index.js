'use strict';

const fs = require('fs');
const path = require('path');
const csso = require('csso');
const escapeStringRegexp = require('escape-string-regexp');

// converts property-name to propertyName
function dashedToCamel(str) {
    return str.replace(/-([a-z])/g, function (m, w) {
        return w.toUpperCase();
    });
}

function parseFile(fileContent, css, /*varNames, */js) {
    const {vars: varsToPaste, extractedProperties} = fileContent;
    Object.keys(extractedProperties).forEach(variable => {
        // TODO: create string to paste in js using fixedParts + varsToPaste (name = ${'var' + index} )
        const variableContent = extractedProperties[variable];
        /*const resolvedValue = variableContent.resolved;
        let {fixedParts, vars, values} = parseVariable(variable, resolvedValue);

        vars.forEach((fullValue) => {

            let varName, cssVarName;
            const indexOfComma = fullValue.indexOf(',');

            if (indexOfComma == -1) {
                cssVarName = fullValue.substring(0, fullValue.length - 1).replace(/\s*var\(\s*!/, '').trim();
            } else {
                cssVarName = fullValue.substring(0, indexOfComma).replace(/\s*var\(\s*!/, '').trim();
            }

            let item;
            if (item = varsToPaste.find(item => item.name == cssVarName)) {
                varName = dashedToCamel(cssVarName.replace('--', ''));
                varNames.push({fullValue, varName});
                item.used = true;
            }
        });*/
        js.push(getNewJsToPrint(variableContent, variable, varsToPaste));
        css.push(getNewCssToPrint(variableContent, variable));
    });
}

function getNewJsToPrint(variableContent, variable, varsToPaste) {
    let js = '';
    const resolvedValue = variableContent.resolved;
    let {fixedParts, vars, values} = parseVariable(variable, resolvedValue);
    console.log(fixedParts.length, vars.length, values.length)
    let valueToPrintInJS = fixedParts[0];

    vars.forEach((fullValue, index) => {

        let varName, cssVarName;
        const indexOfComma = fullValue.indexOf(',');

        if (indexOfComma == -1) {
            cssVarName = fullValue.substring(0, fullValue.length - 1).replace(/\s*var\(\s*/, '').trim();
        } else {
            cssVarName = fullValue.substring(0, indexOfComma).replace(/\s*var\(\s*/, '').trim();
        }

        let item;
        if ((item = varsToPaste.find(item => item.name == cssVarName))) {
            item.used = true;
            varName = dashedToCamel(cssVarName.replace('--', ''));
            valueToPrintInJS += `" + ${varName} + \n"`;
        } else {
            valueToPrintInJS += escapeForJs(values[index]);
        }


        valueToPrintInJS += fixedParts[index + 1];

    });

    Object.keys(variableContent).filter(property => property != 'resolved' && property != 'associatedVars').forEach(property => {
        const simpleSelectors = variableContent[property].filter(item => !item.atrules);
        const selector = simpleSelectors.map(item => item.selectorName).join(',');
        js += `${escapeForJs(selector)} {${escapeForJs(property)}: ${valueToPrintInJS};}`;

        const selectorsWithAtRules = variableContent[property].filter(item => item.atrules);
        selectorsWithAtRules.forEach(selector => {
            selector.atrules.forEach(atrule => {
                js += `${escapeForJs(atrule)} {${escapeForJs(selector.selectorName)} {${escapeForJs(property)}: ${valueToPrintInJS};}}`;
            });
        });
    });

    return js;
}

function getNewCssToPrint(variableContent, valueToPrintInCSS) {
    let css = '';

    Object.keys(variableContent).filter(property => property != 'resolved' && property != 'associatedVars').forEach(property => {
        const simpleSelectors = variableContent[property].filter(item => !item.atrules);
        const selector = simpleSelectors.map(item => item.selectorName).join(',');
        css += `${selector} {${property}: ${valueToPrintInCSS};}`;

        const selectorsWithAtRules = variableContent[property].filter(item => item.atrules);
        selectorsWithAtRules.forEach(selector => {
            selector.atrules.forEach(atrule => {
                css += `${atrule} {${selector.selectorName} {${property}: ${valueToPrintInCSS};}}`;
            });
        });
    });

    return css;
}

function parseVariable(variable, resolvedValue) {

    let regExpStr = '^';
    let lastIndex = 0;
    const fixedParts = [];
    const vars = [];
    const varIdentification = 'var(';

    while (true) {
        const indexOfVar = variable.indexOf(varIdentification, lastIndex);

        if (indexOfVar === -1) {
            const str = variable.substring(lastIndex);
            fixedParts.push(escapeForJs(str));
            regExpStr += escapeStringRegexp(str);
            regExpStr += '$';
            break;
        }

        //const closingIndex = variable.indexOf(')', indexOfVar);
        let numberOfBrackets = 1;
        let closingIndex;
        for (closingIndex = indexOfVar + varIdentification.length; closingIndex < variable.length && numberOfBrackets > 0; closingIndex++) {
            switch (variable[closingIndex]) {
                case '(':
                    numberOfBrackets++;
                    break;
                case ')':
                    numberOfBrackets--;
                    break;
                default:
                    break;
            }
        }

        const str = variable.substring(lastIndex, indexOfVar);
        fixedParts.push(escapeForJs(str));
        regExpStr += escapeStringRegexp(str) + '(.*)';
        lastIndex = closingIndex + 1;

        const newVar = variable.substring(indexOfVar, closingIndex + 1);
        vars.push(newVar);
    }

    const values = resolvedValue.match(new RegExp(regExpStr));
    values.shift();

    return {fixedParts, vars, values};
}

function escapeForJs(str) {
    return str.replace(/(\r\n|\n|\r)/gm, "").replace(/"/g, '\\"');
}

function getJsContent(css, varNames) {
    let jsContent = css;

    varNames.forEach(({fullValue, varName}) => {
        jsContent = jsContent.replace(new RegExp(escapeStringRegexp(fullValue), 'g'), `" + ${varName} + \n"\\n`);
    });

    return jsContent;
}

class ReportalPostCssExtractor {
    constructor(varNames) {
        this.varNames = varNames;
    }

    saveToAssets(compilation, fileName, fileContent) {
        compilation.assets[fileName] = {
            source: function () {
                return new Buffer(fileContent)
            },
            size: function () {
                return Buffer.byteLength(fileContent)
            }
        };
    };

    apply(compiler) {
        compiler.plugin("emit", (compilation, callback) => {

            const dirName = './dist';
            const encoding = 'utf8';
            fs.readdir(dirName, encoding, (err, files) => {
                if (err) {
                    throw err;
                }

                const filesToRead = files.filter(item => /^output.*\.json$/.test(item));

                const css = [], js = [];
                const varsToPaste = [];
                //const varNames = [];

                filesToRead.forEach(file => {
                    const fileContent = JSON.parse(fs.readFileSync(path.resolve(dirName, file), encoding));

                    //parseFile(fileContent, css, varNames);
                    parseFile(fileContent, css, js);
                    fileContent.vars.filter(item => item.used).forEach(variable => {
                        if (!varsToPaste.find(item => item.name == variable.name)) {
                            varsToPaste.push(variable);
                        }
                    });
                });

                const cssText = css.join('');
                const minimizedCss = csso.minify(cssText).css;
                this.saveToAssets(compilation, 'config.css', minimizedCss);

                const usualVars = [], varsForConfig = [];
                const className = 'Config';
                const classFieldName = 'Design';

                varsToPaste.forEach(variable => {
                    const variableName = dashedToCamel(variable.name.replace('--', ''));
                    usualVars.push(`var ${variableName} = ${className}.${classFieldName}.${variableName};`);
                    varsForConfig.push(`${variableName}: "${escapeForJs(variable.value)}"`);
                });

                let variablesConfig = `class ${className} {\n` +
                    `\tstatic var ${classFieldName} = {\n` +
                    `\t\t${varsForConfig.join(',\n\t\t')}\n` +
                    `\t}\n` +
                    `}\n\n\n\n${usualVars.join('\n')}`;

                //const jsContent = getJsContent(minimizedCss, varNames);
                const jsContent = js.join('');
                const jsText = variablesConfig + '\n\nvar str = "\<style\>";\n\nstr += "' + jsContent + '";\n\nstr += "\<\/style\>";\n\ntext.Output.Append(str);';

                this.saveToAssets(compilation, 'config.js', jsText);

                callback();
            });
        });
    }
}

module.exports = ReportalPostCssExtractor;
