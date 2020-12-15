import * as Blockly from "blockly"
import "blockly/blockly_compressed"
import "blockly/javascript_compressed"
import 'blockly/msg/de'

import './blocks/move'
import './blocks/joint_space_pose'
import './blocks/task_space_pose'
import './blocks/gripper_open'
import './blocks/gripper_close'
import './blocks/joint_absolute'
import './blocks/joint_relative'

const generator = Blockly.JavaScript;
generator.STATEMENT_PREFIX = 'highlightBlock(%1);\n'
generator.addReservedWords('highlightBlock');
generator.addReservedWords('sendRobotCommand');
generator.addReservedWords('code');

var Interpreter = require('js-interpreter');

import Simulation from '../simulator/simulation'


var blocklyArea = document.querySelector('.blocks-container');
var blocklyDiv = document.getElementById('blocks-canvas');

var workspace = Blockly.inject(
    blocklyDiv,
    {
        toolbox: document.getElementById('blocks-toolbox'),
        zoom: {
            controls: true,
            wheel: false,
            startScale: 1.0,
            maxScale: 3,
            minScale: 0.3,
            scaleSpeed: 1.1,
            pinch: true
        },
        grid: {
            spacing: 20,
            length: 3,
            colour: '#ddd',
            snap: true
        },
        trashcan: true
    });


var onresize = function(e) {
    // Compute the absolute coordinates and dimensions of blocklyArea.
    var element = blocklyArea;
    var x = 0;
    var y = 0;

    do {
        x += element.offsetLeft;
        y += element.offsetTop;
        element = element.offsetParent;
    } while (element);

    // Position blocklyDiv over blocklyArea.
    blocklyDiv.style.left = x + 'px';
    blocklyDiv.style.top = y + 'px';
    blocklyDiv.style.width = blocklyArea.offsetWidth + 'px';
    blocklyDiv.style.height = blocklyArea.offsetHeight + 'px';
    Blockly.svgResize(workspace);
};
    
window.addEventListener('resize', onresize, false);
onresize();
Blockly.svgResize(workspace);


// Setup the run button
const runButton = document.querySelector('.run-button');

runButton.onclick = function () {
    runButton.classList.toggle('running');

    // No need to react to the other click, execution will check the status of the
    // button frequently
    if (runButton.classList.contains('running')) {
        runProgram();
    }

    return false;
};


// Get simulation instance
var simulation = null;

Simulation.getInstance(sim => {
    // Once the simulation is available we can enable the run button
    simulation = sim;
    runButton.disabled = false;
});

function simulationAPI(interpreter, globalObject) {
    let wrapper = function (id) {
        return workspace.highlightBlock(id);
    }
    interpreter.setProperty(globalObject, 'highlightBlock',
        interpreter.createNativeFunction(wrapper));
    
    wrapper = function (command, ...args) {
        return simulation.run(step, command, ...args);
    }
    interpreter.setProperty(globalObject, 'sendRobotCommand',
        interpreter.createNativeFunction(wrapper));
}


class ExecutionContext {
    constructor(blocks, interpreter) {
        this.blocks = blocks
        this.pos = 0
        this.interpreter = interpreter
        this.code = []

        return this
    }

    nextBlock() {
        return this.finished() ? null : this.blocks[this.pos++];
    }

    finished() {
        return this.pos >= this.blocks.length;
    }
}

var executionContext = null;

function runProgram() {
    const interpreter = new Interpreter('', simulationAPI);
    let blocks = workspace.getAllBlocks(true);
    executionContext = new ExecutionContext(blocks, interpreter);
    
    generator.init(workspace);
    step();
}

function step() {
    let block = executionContext.nextBlock();
    if (block) {
        runBlock(block);
        // Our robot command blocks will use a callback to continue execution
        if (!block.deferredStep) {
            step();
        }
    }
    else {
        onProgramFinished();
    }
}

function runBlock(block) {
    // Copied from blockly/core/generator.js
    let line = generator.blockToCode(block, true);
    if (Array.isArray(line)) {
        line = line[0];
    }
    if (line) {
        if (block.outputConnection) {
            line = generator.scrubNakedValue(line);
            if (generator.STATEMENT_PREFIX && !block.suppressPrefixSuffix) {
                line = generator.injectId(generator.STATEMENT_PREFIX, block) + line;
            }
            if (generator.STATEMENT_SUFFIX && !block.suppressPrefixSuffix) {
                line = line + generator.injectId(generator.STATEMENT_SUFFIX, block);
            }
        }
        executionContext.code.push(line);
    }

    // Execute just the block
    console.log(line);
    executionContext.interpreter.appendCode(line);
    executionContext.interpreter.run();
}

function onProgramFinished() {
    let code = executionContext.code;
    let l = code.length;
    code = generator.finish(code);
    // The generator may add some cleanup code at the end
    if (code.length > l) {
        let remainder = code.slice(code.length - l);
        try {
            executionContext.interpreter.appendCode(remainder);
            executionContext.interpreter.run();
        }
        catch (e) { /*  */ }
    }

    workspace.highlightBlock(null);
    runButton.classList.remove('running');
    console.log('Execution finished');
}
