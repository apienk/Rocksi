import * as Blockly from "blockly";

Blockly.Blocks["joint_unlock"] = {
	init: function () {
		Simulation.getInstance().then(sim => {
			this.numJoints = sim.robot.joints.movable.length;
			let the_options = [];

			for (let i = 1; i <= this.numJoints; i++) {
				the_options.push(['j' + i, i.toString()]);
			}

			this.jsonInit({
				type: "joint_unlock",
				message0: "Entsperre %1",
				args0: [
					{
						"type": "field_dropdown",
						"name": "JOINT",
						"options": the_options
					}
				],
				inputsInline: false,
				previousStatement: null,
				nextStatement: null,
				style: 'extras_blocks',
				tooltip:
					"Erlaubt Änderungen des Gelenkwinkels für das gewählte Gelenk",
				helpUrl: "",
			});
		});
	},
};


Blockly.JavaScript["joint_unlock"] = function (block) {
	let joint = block.getFieldValue('JOINT');
	return code = 'robot("unlockJoint", ' + joint + ');';
};
