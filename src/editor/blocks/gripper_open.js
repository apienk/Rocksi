import * as Blockly from "blockly";

Blockly.Blocks["gripper_open"] = {
	init: function () {
		this.jsonInit({
			type: "gripper_open",
			message0: "Greifer öffnen",
			previousStatement: null,
			nextStatement: null,
			colour: 120,
			tooltip: "Öffnet den Greifer auf volle Weite",
			helpUrl: "",
		});
	},
};

Blockly.JavaScript["gripper_open"] = function (block) {
	return ["gripper_open();", Blockly.JavaScript.ORDER_FUNCTION_CALL];
};
