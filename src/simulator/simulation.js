import * as Blockly from "blockly"
import { Vector3, Euler } from "three"
var TWEEN = require('@tweenjs/tween.js');

// Velocities to move a joint one unit 
// (m/s for prismatic joints, rad/s for revolute joints)
Blockly.Msg.DEFAULT_SPEED_MOVE = 0.5;
Blockly.Msg.DEFAULT_SPEED_GRIPPER = 0.1;
Blockly.Msg.DEFAULT_SPEED_JOINT = 0.7;


function deg2rad(deg) {
    return deg * Math.PI / 180.0;
}

function clampJointAngle(joint, angle) {
    // ROS is limiting the joint values by itself, but this prevents long tweens
    // where nothing happens because a joint is already past its limit
    let min = joint.limit.lower;
    let max = joint.limit.upper;
    return Math.min(max, Math.max(min, angle));
}

function getDuration(robot, target, vmax) {
    let smax = 0.0;

    // Find the joint that has to move the farthest
    for (const j in target) {
        smax = Math.max(smax, Math.abs(robot.joints[j].angle - target[j]));
    }

    return smax / vmax * 1000;  // ms
}

class TheSimulation {
    constructor(robot, ik, renderCallback) {
        this.robot = robot;
        this.ik = ik;
        this._renderCallback = renderCallback;

        this.lockedJoints = [];

        this.running = false;
        this.velocities = {
            move: Blockly.Msg.DEFAULT_SPEED_MOVE,
            gripper: Blockly.Msg.DEFAULT_SPEED_GRIPPER,
            joint: Blockly.Msg.DEFAULT_SPEED_JOINT,
        }
    }

    reset() {
        this.unlockJoints();
        this.setDefaultVelocities();
    }

    run(command, ...args) {
        try {
            this[command](...args);
        }
        catch (e) {
            console.error('Failed to run command \'' + command + '(' + args + ')\':' + e);
            throw (e);
        }
    }

    runAsync(finishCallback, command, ...args) {
        let p = new Promise((resolve, reject) => {
            try {
                this.run(command, resolve, reject, ...args);
            }
            catch (e) {
                reject(e);
            }
        });

        p.then(msg => {
            console.log(command + '(' + args + '):' + msg);
            finishCallback();
        });
    }

    cancel() {
        console.log('cancel');
        // Will prevent further callbacks to _animate
        this.running = false;

        for (const t of TWEEN.getAll()) {
            t.stop();
        }
        // As this is called by _onTweenFinished, this prevents having multiple tweens
        // with different end times, but that's not a use case at the moment
        TWEEN.removeAll();
    }


    setParam(param, value) {
        try {
            if (param.startsWith('velocity')) {
                let motion = param.split('/')[1];
                value = parseFloat(value);
                switch (motion) {
                    case 'move':
                        this.velocities.move = value;
                        break;
                    case 'gripper':
                        this.velocities.gripper = value;
                        break;
                    case 'joint':
                        this.velocities.joint = value;
                        break;
                    default:
                        throw ('invalid value \'' + value + '\'');
                }
            }
            else {
                throw ('unknown parameter');
            }
        } catch (e) {
            console.warn('Failed to set ' + param + ': ' + e);
        }
    }

    setDefaultVelocities() {
        console.log('> Resetting velocities to defaults');

        this.velocities = {
            move: Blockly.Msg.DEFAULT_SPEED_MOVE,
            gripper: Blockly.Msg.DEFAULT_SPEED_GRIPPER,
            joint: Blockly.Msg.DEFAULT_SPEED_JOINT,
        }
    }

    
    lockJoint(jointIdx) {
        console.log('> Locking joint ' + jointIdx);
        
        if (this.lockedJoints.includes(jointIdx)) {
            console.warn('> ... but joint ' + jointIdx + ' is already locked');
            return;
        }

        this.lockedJoints.push(jointIdx);
    }

    unlockJoint(jointIdx) {
        console.log('> Unlocking joint ' + jointIdx);
        let idx = this.lockedJoints.indexOf(jointIdx);
        
        if (idx < 0) {
            console.warn('> ... but joint ' + jointIdx + ' is not locked');
            return;
        }

        this.lockedJoints.splice(idx, 1);
    }

    unlockJoints() {
        console.log('> Unlocking all joints');
        this.lockedJoints = [];
    }


    getJointSpacePose() {
        const robot = this.robot;
        const pose = [];
        for (let idx = 0; idx < robot.jointsOrdered.length; idx++) {
            const joint = robot.jointsOrdered[idx];
            if (joint._jointType !== 'fixed' && robot.isArm(joint)) {
                pose.push(joint.angle);
            }
        }
        console.log(pose);
        return pose;
    }

    getTaskSpacePose() {
        const pose = [];

        const m = this.robot.tcp.matrixWorld();
        const pos = new Vector3();
        pos.setFromMatrixPosition(m);
        const rot = new Euler();
        rot.setFromRotationMatrix(m);
        
        // x, y, z, roll, pitch, yaw
        pose.push(pos.x, pos.y, pos.z, rot.x, rot.y, rot.z);
        return pose;
    }


    move(resolve, reject, pose) {
        // Seems to be a weird bug in js-interpreter concerning varargs and arrays
        if (pose.class === 'Array' && pose.length === undefined) {
            let newPose = [];
            for (const p in pose.properties) {
                if (p.match(/\d+/g)) {
                    newPose[p] = pose.properties[p];
                }
            }
            pose = newPose;
        }

        const space = pose.shift();
        switch (space) {
            case 'task_space':
                // Task space pose
                console.log('> Moving robot to task space pose ' + pose);

                // TODO Calculate joint angles through inverse kinematic, fall through to Joint Space Pose
                reject('Task space poses not supported yet');
                break;

            case 'joint_space':
                // Joint space pose
                console.log('> Moving robot to joint space pose ' + pose);

                const robot = this.robot;
                const start = {};
                const target = {};
                
                for (let i = 0; i < pose.length; i++) {
                    const joint = robot.jointsOrdered[i];
                    start[joint.name] = joint.angle;
                    target[joint.name] = clampJointAngle(joint, deg2rad(pose[i]));
                }
                
                const duration = getDuration(robot, target, this.velocities.move);
                let tween = this._makeTween(start, target, duration, resolve, reject);
                this._start(tween);
                break;

            default:
                console.error('move: unknown configuration space \'' + space + '\'');
        }
    }

    gripper_close(resolve, reject) {
        console.log('> Closing hand');
        
        const robot = this.robot;
        const start = {};
        const target = {};

        for (const finger of robot.fingers) {
            if (!robot.isJoint(finger)) {
                continue;
            }
            start[finger.name] = finger.angle;
            target[finger.name] = finger.limit.lower;  // fully closed
        }

        const duration = getDuration(robot, target, this.velocities.gripper);
        let tween = this._makeTween(start, target, duration, resolve, reject);
        this._start(tween);
    }

    gripper_open(resolve, reject) {
        console.log('> Opening hand');

        const robot = this.robot;
        const start = {};
        const target = {};
        
        for (const finger of robot.fingers) {
            if (!robot.isJoint(finger)) {
                continue;
            }
            start[finger.name] = finger.angle;
            target[finger.name] = finger.limit.upper;  // fully opened
        }
        
        const duration = getDuration(robot, target, this.velocities.gripper);
        let tween = this._makeTween(start, target, duration, resolve, reject);
        this._start(tween);
    }

    joint_absolute(resolve, reject, jointIdx, angle) {
        console.log('> Setting joint ' + jointIdx + ' to ' + angle + ' degrees');

        if (this.lockedJoints.includes(jointIdx)) {
            console.log('> ... but joint ' + jointIdx + ' is locked');
            resolve('locked');
            return;
        }

        const start = {};
        const target = {};
        
        const joint = this.robot.jointsOrdered[jointIdx - 1];
        start[joint.name] = joint.angle;
        target[joint.name] = clampJointAngle(joint, deg2rad(angle));

        const duration = getDuration(this.robot, target, this.velocities.joint);
        let tween = this._makeTween(start, target, duration, resolve, reject);
        this._start(tween);
    }

    joint_relative(resolve, reject, jointIdx, angle) {
        console.log('> Rotating joint ' + jointIdx + ' by ' + angle + ' degrees');
        
        const joint = this.robot.jointsOrdered[jointIdx - 1];
        let angleAbs = joint.angle * 180.0 / Math.PI + angle;  // degrees
        this.joint_absolute(resolve, reject, jointIdx, angleAbs);
    }


    _makeTween(start, target, duration, resolve, reject) {
        const robot = this.robot;

        // Locked joints should not be animated
        for (const j in this.lockedJoints) {
            const name = robot.jointsOrdered[j].name;
            delete target[name];
        }

        let tween = new TWEEN.Tween(start)
            .to(target, duration)
            .easing(TWEEN.Easing.Quadratic.Out);

        tween.onUpdate(object => {
            for (const j in object) {
                robot.joints[j].setJointValue(object[j]);
            }
        });

        tween.onComplete(object => {
            this.running = false;
            resolve('success');
        });

        tween.onStop(object => {
            this.running = false;
            reject('tween obsolete');
        })

        return tween;
    }

    _start(tween) {
        if (this.running) {
            return;
        }

        this.running = true;
        tween.start();
        // => captures the 'this' reference
        window.requestAnimationFrame(() => this._animate());
    }

    _animate(time) {
        TWEEN.update(time);
        this._renderCallback();

        if (this.running) {
            // => captures the 'this' reference
            window.requestAnimationFrame(() => this._animate());
        }
    }
}


/*
 * Singleton with async getter, will be initialized by the robot simulator.
 */
const Simulation = {
    _simulation: null,
    _awaiting: [],

    getInstance: function(callback) {
        let s = this._simulation;
        if (s) {
            // Immediate callback
            callback(s);
        }
        else {
            // Wait for simulation to be initialized
            this._awaiting.push(callback);
        }
    },

    init: function(robot, ik, renderCallback) {
        let s = this._simulation = new TheSimulation(robot, ik, renderCallback);
        this._awaiting.forEach(cb => cb(s));
        this._awaiting = []
    }
};


export default Simulation;