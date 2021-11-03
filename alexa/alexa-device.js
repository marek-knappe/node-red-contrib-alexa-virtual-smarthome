/**
 * NodeRED Alexa SmartHome
 * Copyright (C) 2021 Claudio Chimera.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 **/

// https://developer.amazon.com/en-US/docs/alexa/smarthome/understand-the-smart-home-skill-api.html
// https://developer.amazon.com/en-US/docs/alexa/device-apis/smart-home-general-apis.html
// https://developer.amazon.com/en-US/docs/alexa/device-apis/list-of-interfaces.html
// https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-powercontroller.html
// https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-discovery.html
// https://developer.amazon.com/en-US/docs/alexa/device-apis/list-of-interfaces.html
// https://developer.amazon.com/en-US/docs/alexa/smarthome/state-reporting-for-a-smart-home-skill.html
// https://developer.amazon.com/en-US/docs/alexa/smarthome/get-started-with-device-templates.html
// https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-property-schemas.html
// https://github.com/node-red/node-red/blob/master/packages/node_modules/%40node-red/nodes/core/function/15-change.html

const float_values = {
    color: {
        saturation: true,
        brightness: true
    }
};

module.exports = function (RED) {
    "use strict";

    const DEFAULT_PAYLOAD_VERSION = '3';
    const Formats = {
        BOOL: 1,
        INT: 2,
        FLOAT: 4,
        STRING: 8,
        DATETIME: 16,
        PRIMITIVE: 31,
        OBJECT: 32,
        ARRAY: 64,
        MANDATORY: 128,
        COPY_OBJECT: 256,
    };

    const EXCLUSIVE_STATES = {
        color: ['colorTemperatureInKelvin'],
        colorTemperatureInKelvin: ['color'],
        lowerSetpoint: ['targetSetpoint'],
        upperSetpoint: ['targetSetpoint'],
        targetSetpoint: ['lowerSetpoint', 'upperSetpoint'],
    };

    const DEEP_STATES = ['toggles', 'modes', 'ranges'];

    const CAMERASTREAMS_STATE_TYPE = {
        cameraStreams: {
            type: Formats.OBJECT | Formats.ARRAY,
            attributes: {
                uri: Formats.STRING,
                expirationTime: Formats.DATETIME + Formats.MANDATORY,
                idleTimeoutSeconds: {
                    type: Formats.INT + Formats.MANDATORY,
                    min: 0
                },
                protocol: {
                    type: Formats.STRING + Formats.MANDATORY,
                    values: ['HLS', 'RTSP'],
                },
                resolution: {
                    type: Formats.OBJECT + Formats.MANDATORY,
                    attributes: {
                        width: Formats.INT + Formats.MANDATORY,
                        height: {
                            type: Formats.INT + Formats.MANDATORY,
                            min: 480,
                            max: 1080
                        }
                    }
                },
                authorizationType: {
                    type: Formats.STRING + Formats.MANDATORY,
                    values: ['NONE', 'BASIC', 'DIGEST'],
                },
                videoCodec: {
                    type: Formats.STRING + Formats.MANDATORY,
                    values: ['H264', 'MPEG2', 'MJPEG', 'JPG']
                },
                audioCodec: {
                    type: Formats.STRING + Formats.MANDATORY,
                    values: ['AAC', 'G711', 'NONE']
                }
            }
        },
        imageUri: Formats.STRING + Formats.MANDATORY
    }


    /******************************************************************************************************************
     *
     *
     */
    class AlexaDeviceNode {
        constructor(config) {
            RED.nodes.createNode(this, config);
            const node = this;
            node.config = config;
            node.YES = RED._("alexa-device.label.YES");
            node.NO = RED._("alexa-device.label.NO");
            node.state = {};
            node.state_types = {};

            node.alexa = RED.nodes.getNode(node.config.alexa);

            if (!node.config.alexa) {
                node.error(RED._("alexa-device.error.missing-config"));
                node.status({ fill: "red", shape: "dot", text: RED._("alexa-device.error.missing-config") });
                return;
            } else if (typeof node.alexa.register !== 'function') {
                node.error(RED._("alexa-device.error.missing-bridge"));
                node.status({ fill: "red", shape: "dot", text: RED._("alexa-device.error.missing-bridge") });
                return;
            }
            if (node.isVerbose()) node._debug("config " + JSON.stringify(config));
            if (node.isVerbose()) node._debug("display_categories " + JSON.stringify(node.config.display_categories));
            let names = node.config.display_categories.map(dt => RED._("alexa-device.display_category." + dt));
            node.device_desc = names.join();

            node.setupCapabilities();
            node.alexa.register(node);

            node.on('input', function (msg) {
                node.onInput(msg);
            });

            node.on('close', function (removed, done) {
                node.onClose(removed, done);
            });
            node.updateStatusIcon();
            if (node.isVerbose()) node._debug("Node " + node.config.name + " configured");
        }

        //
        //
        //
        //
        isVerbose() {
            return this.config.alexa && this.alexa.config.verbose;
        }

        //
        //
        //
        //
        _debug(msg) {
            console.log('AlexaDeviceNode:' + msg); // TODO REMOVE
            this.debug('AlexaDeviceNode:' + msg);
        }

        //
        //
        //
        //
        onClose(removed, done) {
            const node = this;
            if (node.isVerbose()) node._debug("(on-close) " + node.config.name);
            node.alexa.deregister(node, removed);
            // TODO if removed, send remove event?

            if (typeof done === 'function') {
                done();
            }
        }

        //
        //
        //
        //
        onInput(msg) {
            const node = this;
            const topicArr = String(msg.topic || '').split('/');
            const topic = topicArr[topicArr.length - 1].toUpperCase();
            if (node.isVerbose()) node._debug("onInput " + JSON.stringify(msg));
            if (node.isVerbose()) node._debug("onInput " + topic);
            if (topic === 'REPORTSTATE') {
                node.alexa.send_change_report(node.id).then(() => { });
            } else if (topic === 'GETSTATE') {
                node.send({
                    topic: "getState",
                    payload: node.state
                })
                // node.sendState([], {}, undefined, "getState");
            } else if (topic === 'GETALLSTATES') {
                let state = node.alexa.get_all_states();
                node.send({
                    topic: "getAllStates",
                    payload: state
                })
            } else if (topic === 'GETNAMES') {
                let names = node.alexa.get_all_names();
                node.send({
                    topic: "getNames",
                    payload: names
                })
            } else if (topic === 'DOORBELLPRESS') {
                // TODO https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-doorbelleventsource.html
                // https://developer.amazon.com/en-US/docs/alexa/smarthome/state-reporting-for-a-smart-home-skill.html#cause-object
                // cause APP_INTERACTION PERIODIC_POLL PHYSICAL_INTERACTION RULE_TRIGGER VOICE_INTERACTION 
                // timestamp
                if (node.isVerbose()) node._debug("CCHI " + node.id + "  " + topicArr[topicArr.length - 1] + " " + msg.payload || '');
                process.nextTick(() => {
                    node.alexa.send_doorbell_press(node.id, msg.payload || '');
                });
            } else if (topic === 'CAMERASTREAMS') {
                node.updateState(msg.payload || {}, node.cameraStreams, CAMERASTREAMS_STATE_TYPE, {});
                // node.cameraStreams = msg.payload;
                if (node.isVerbose()) node._debug("CCHI cameraStreams " + node.id + " " + JSON.stringify(node.cameraStreams));
            } else if (topic === 'SETMEDIA') {
                const media_to_set = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
                const media_id_to_set = media_to_set.map(m => m.id);
                const current_media_id = node.media.map(m => m.id);
                const media_id_to_remove = current_media_id.filter(id => !media_id_to_set.includes(id));
                node.media = media_to_set;
                const media_id_to_add = node.media.map(m => m.id);
                if (node.media) node.alexa.send_media_created_or_updated(node.id, node.media);
                if (media_id_to_remove.length > 0) node.alexa.send_media_deleted(node.id, media_id_to_remove);
                if (node.isVerbose()) node._debug("CCHI media " + node.id + " " + JSON.stringify(node.media));
            } else if (topic === 'ADDORUPDATEMEDIA') {
                const media_to_add = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
                const media_id_to_add = media_to_add.map(m => m.id);
                const existing_media_to_update = node.media.filter(m => media_id_to_add.includes(m.id));
                const existing_media_id_to_update = existing_media_to_update.map(m => m.id);
                node.media = node.media.filter(m => !existing_media_id_to_update.includes(m.id)); // Remove old media to update
                media_to_add.forEach(m => node.media.push(m));
                if (media_to_add) node.alexa.send_media_created_or_updated(node.id, media_to_add);
                if (node.isVerbose()) node._debug("CCHI media " + node.id + " " + JSON.stringify(node.media));
            } else if (topic === 'REMOVEMEDIA') {
                const media_id_to_remove = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
                const media_to_remove = node.media.filter(m => media_id_to_remove.includes(m.id));
                node.media = node.media.filter(m => !media_id_to_remove.includes(m.id));
                const media_id_removed = media_to_remove.map(m => m.id);
                if (media_id_removed.length > 0) node.alexa.send_media_deleted(node.id, media_id_removed);
                if (node.isVerbose()) node._debug("CCHI media " + node.id + " " + JSON.stringify(node.media));
            } else if (topic === 'SETSECURITYDEVICENAMESINERROR') {
                const topics = typeof msg.payload === 'string' ? [] : (Array.isArray(msg.payload || []) ? [] : msg.payload.topics);
                const names = typeof msg.payload === 'string' ? [msg.payload] : (Array.isArray(msg.payload || []) ? msg.payload || [] : msg.payload.names);
                node.security_device_names_in_error = [];
                for (const [id, name] of Object.entries(node.alexa.get_devices_id_name(names, topics))) {
                    node.security_device_names_in_error.push(name);
                }
                node._debug("CCHI " + node.id + " security_device_names_in_error " + JSON.stringify(node.security_device_names_in_error));
            } else if (topic === 'ADDSECURITYDEVICENAMESINERROR') {
                const a_topics = typeof msg.payload === 'string' ? [] : (Array.isArray(msg.payload || []) ? [] : msg.payload.topics);
                let a_names = typeof msg.payload === 'string' ? [msg.payload] : (Array.isArray(msg.payload || []) ? msg.payload || [] : msg.payload.names);
                node.security_device_names_in_error.forEach(name => a_names.push(name));
                node.security_device_names_in_error = [];
                for (const [id, name] of Object.entries(node.alexa.get_devices_id_name(a_names, a_topics))) {
                    node.security_device_names_in_error.push(name);
                }
                node._debug("CCHI " + node.id + " security_device_names_in_error " + JSON.stringify(node.security_device_names_in_error));
            } else if (topic === 'DELSECURITYDEVICENAMESINERROR') {
                const r_topics = typeof msg.payload === 'string' ? [] : (Array.isArray(msg.payload || []) ? [] : msg.payload.topics);
                let r_names = typeof msg.payload === 'string' ? [msg.payload] : (Array.isArray(msg.payload || []) ? msg.payload || [] : msg.payload.names);
                for (const [id, name] of Object.entries(node.alexa.get_devices_id_name(r_names, r_topics))) {
                    node.security_device_names_in_error = node.security_device_names_in_error.filter(i_name => i_name != name);
                }
                node._debug("CCHI2 " + node.id + " security_device_names_in_error " + JSON.stringify(node.security_device_names_in_error));
            } else if (topic === 'MEASUREMENTSREPORT') {
                let other_data = {};
                if (msg.correlationToken) {
                    other_data['event'] = {
                        header: {
                            correlationToken: msg.correlationToken
                        }
                    }
                };
                node.alexa.send_event_gw(node.id, 'Alexa.DeviceUsage.Meter', 'MeasurementsReport', msg.payload, other_data).then(() => { });
            } else if (topic === 'EXECDIRECTIVE') { // test
                if (node.isVerbose()) {
                    node._debug(" CCHI execDirective " + msg.namespace + " " + msg.name + " " + JSON.stringify(msg.payload));
                    let event_payload = {};
                    let modified = node.execDirective(msg, msg.payload, event_payload)
                    node._debug("CCHI modified " + node.id + " modified " + JSON.stringify(modified));
                    node._debug("CCHI event_payload " + node.id + " event_payload " + JSON.stringify(event_payload));
                }
            } else {
                let msg1 = msg;
                Object.keys(node.state_types).forEach(function (key) {
                    if (topic == key.toUpperCase()) {
                        msg1 = {
                            payload: {}
                        };
                        msg1.payload[key] = msg.payload;
                        node._debug(".input: found state " + key);
                    }
                });

                if (node.isVerbose()) node._debug("CCHI Before " + node.id + " state " + JSON.stringify(node.state));
                // const modified = node.setValues(msg1.payload || {}, node.state);
                const modified = node.updateState(msg1.payload || {}, node.state, node.state_types, EXCLUSIVE_STATES);
                if (node.isVerbose()) node._debug("CCHI " + node.id + " modified " + JSON.stringify(modified));
                if (node.isVerbose()) node._debug("CCHI After " + node.id + " state " + JSON.stringify(node.state));
                if (modified.length > 0) {
                    process.nextTick(() => {
                        node.alexa.send_change_report(node.id, modified).then(() => { });
                    });
                }
                // node.sendState(modified, msg.payload);
            }
        }

        setupCapabilities() {
            const node = this;
            let state_types = node.state_types;
            node.capabilities = [];
            node.endpoint = node.getEndpoint();

            // https://developer.amazon.com/en-US/docs/alexa/device-apis/list-of-interfaces.html

            // AutomationManagement
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-automationmanagement.html

            // BrightnessController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-brightnesscontroller.html
            if (node.config.i_brightness_controller) {
                if (node.isVerbose()) node._debug("Alexa.BrightnessController");
                node.addCapability("Alexa.BrightnessController", {
                    brightness: 50
                });
                state_types['brightness'] = {
                    type: Formats.INT,
                    min: 0,
                    max: 100
                };
            }
            // CameraStreamController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-camerastreamcontroller.html
            if (node.config.i_camera_stream_controller) {
                if (node.isVerbose()) node._debug("Alexa.CameraStreamController");
                node.cameraStreams = {};
                let camera_stream_configurations = [];
                node.config.camera_stream_configurations.forEach(c => {
                    let r = [];
                    c.r.forEach(wh => {
                        r.push({
                            width: wh[0],
                            height: wh[1]
                        });
                    });
                    camera_stream_configurations.push({
                        protocols: c.p,
                        resolutions: r,
                        authorizationTypes: c.t,
                        videoCodecs: c.v,
                        audioCodecs: c.a
                    });
                });
                node.addCapability("Alexa.CameraStreamController", undefined,
                    {
                        cameraStreamConfigurations: camera_stream_configurations
                    });
            }

            // ChannelController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-channelcontroller.html
            if (node.config.i_channel_controller) {
                if (node.isVerbose()) node._debug("Alexa.ChannelController");
                node.addCapability("Alexa.ChannelController", {
                    channel: {
                        number: "",
                        callSign: "",
                        affiliateCallSign: ""
                    }
                });
                // TODO one of channel or channelMetadata must be filled
                state_types['channel'] = {
                    type: Formats.OBJECT,
                    attributes: {
                        number: {
                            type: Formats.INT,
                            min: 0
                        },
                        callSign: Formats.STRING,
                        affiliateCallSign: Formats.STRING,
                        uri: Formats.STRING,
                    },
                };
                state_types['channelMetadata'] = {
                    type: Formats.OBJECT,
                    attributes: {
                        name: Formats.STRING,
                        image: Formats.STRING,
                    }
                };
            }
            // ColorController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-colorcontroller.html
            if (node.config.i_color_controller) {
                if (node.isVerbose()) node._debug("Alexa.ColorController");
                node.addCapability("Alexa.ColorController", {
                    color: {
                        hue: 350.5,
                        saturation: 0.7138,
                        brightness: 0.6524
                    }
                });
                state_types['color'] = {
                    type: Formats.OBJECT,
                    attributes: {
                        hue: {
                            type: Formats.FLOAT,
                            min: 0,
                            max: 360
                        },
                        saturation: {
                            type: Formats.FLOAT,
                            min: 0,
                            max: 1
                        },
                        brightness: {
                            type: Formats.FLOAT,
                            min: 0,
                            max: 1
                        },
                    },
                    exclusive_states: ['colorTemperatureInKelvin']
                };
            }

            // ColorTemperatureController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-colortemperaturecontroller.html
            if (node.config.i_color_temperature_controller) {
                if (node.isVerbose()) node._debug("Alexa.ColorTemperatureController");
                node.addCapability("Alexa.ColorTemperatureController", {
                    colorTemperatureInKelvin: 5500
                });
                state_types['colorTemperatureInKelvin'] = {
                    type: Formats.INT,
                    min: 1000,
                    max: 10000,
                    exclusive_states: ['color']
                };
            }

            // ContactSensor
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-contactsensor.html
            if (node.config.i_contact_sensor) {
                if (node.isVerbose()) node._debug("Alexa.ContactSensor");
                node.addCapability("Alexa.ContactSensor", {
                    detectionState: 'NOT_DETECTED'
                });
                state_types['contactDetectionState'] = {
                    type: Formats.STRING + Formats.MANDATORY,
                    values: ['NOT_DETECTED', 'DETECTED'],
                };
            }

            // Device Usage Estimation
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-deviceusage-estimation.html
            if (node.config.i_device_usage_estimation) {
                if (node.isVerbose()) node._debug("Alexa.DeviceUsage.Estimation");
                let powerProfile = {};
                if (node.config.i_color_controller || node.config.i_color_temperature_controller) {
                    powerProfile['type'] = 'BRIGHTNESS_COLOR';
                } else if (node.config.i_brightness_controller) {
                    powerProfile['type'] = 'BRIGHTNESS';
                } else if (node.config.i_power_controller) {
                    powerProfile['type'] = 'POWER';
                }
                if (powerProfile['type']) {
                    powerProfile['standbyWattage'] = {
                        "value": this.to_float(node.config.standby_wattage, .1),
                        "units": "WATTS"
                    };
                    if (powerProfile['type'] === 'POWER') {
                        powerProfile['onWattage'] = {
                            "value": this.to_float(node.config.maximum_wattage, 10),
                            "units": "WATTS"
                        };
                    } else {
                        powerProfile['maximumWattage'] = {
                            "value": this.to_float(node.config.maximum_wattage, 9),
                            "units": "WATTS"
                        };
                    }
                    node.addCapability("Alexa.DeviceUsage.Estimation", undefined,
                        {
                            configurations: {
                                powerProfile: powerProfile
                            }
                        });
                }
            }

            // Device Usage Meter
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-deviceusage-meter.html
            if (node.config.i_device_usage_meter) {
                if (node.isVerbose()) node._debug("Alexa.DeviceUsage.Meter");
                let energy_sources = {};
                let add_interface = false;
                if (node.config.electricity_measuring_method && node.config.electricity_unit) {
                    add_interface = true;
                    energy_sources['electricity'] = {
                        unit: node.config.electricity_measuring_method,
                        measuringMethod: node.config.electricity_unit,
                        defaultResolution: parseInt(node.config.electricity_default_resolution) || 3600
                    };
                }
                if (node.config.natural_gas_measuring_method && node.config.natural_gas_unit) {
                    add_interface = true;
                    energy_sources['naturalGas'] = {
                        unit: node.config.natural_gas_measuring_method,
                        measuringMethod: node.config.natural_gas_unit,
                        defaultResolution: parseInt(node.config.natural_gas_default_resolution) || 3600
                    };
                }
                if (add_interface) {
                    node.addCapability("Alexa.DeviceUsage.Meter", undefined, {
                        configurations: {
                            energySources: energy_sources
                        }
                    });
                }
            }

            // Doorbell Event Source
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-doorbelleventsource.html
            if (node.config.i_doorbell_event_source) {
                if (node.isVerbose()) node._debug("Alexa.DoorbellEventSource");
                let capability = node.addCapability("Alexa.DoorbellEventSource");
                capability['proactivelyReported'] = true;
            }

            // EndpointHealth
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-endpointhealth.html
            if (node.config.i_endpoint_health) {
                if (node.isVerbose()) node._debug("Alexa.EndpointHealth");
                node.addCapability("Alexa.EndpointHealth", {
                    connectivity: {
                        value: "OK"
                    } // UNREACHABLE
                });
                // TODO battery, radioDiagnostics, networkThroughput
                state_types['connectivity'] = {
                    type: Formats.OBJECT + Formats.MANDATORY,
                    attributes: {
                        value: {
                            type: Formats.STRING + Formats.MANDATORY,
                            values: ['OK', 'UNREACHABLE'],
                        },
                        reason: {
                            type: Formats.STRING,
                            values: ['WIFI_BAD_PASSWORD',
                                'WIFI_AP_NOT_FOUND',
                                'WIFI_ROUTER_UNREACHABLE',
                                'WIFI_AP_CHANNEL_QUALITY_LOW',
                                'INTERNET_UNREACHABLE',
                                'CAPTIVE_PORTAL_CHECK_FAILED',
                                'UNKNOWN'
                            ],
                        }
                    }
                };
                state_types['battery '] = {
                    type: Formats.OBJECT,
                    attributes: {
                        health: {
                            type: Formats.OBJECT + Formats.MANDATORY,
                            attributes: {
                                state: {
                                    type: Formats.STRING,
                                    values: ['OK', 'WARNING', 'CRITICAL'],
                                },
                                reasons: {
                                    type: Formats.STRING + Formats.ARRAY,
                                    values: [
                                        'COLD',
                                        'DEAD',
                                        'OVERHEATED',
                                        'OVER_VOLTAGE',
                                        'NO_BATTERY',
                                        'LOW_CHARGE',
                                        'UNKNOWN'
                                    ]
                                }
                            }
                        },
                        chargingHealth: {
                            type: Formats.OBJECT,
                            attributes: {
                                state: {
                                    type: Formats.STRING,
                                    values: ['OK', 'WARNING', 'CRITICAL'],
                                },
                                reasons: {
                                    type: Formats.STRING + Formats.ARRAY,
                                    values: [
                                        'LOW_POWER',
                                        'INCOMPATIBLE_CHARGER',
                                        'UNKNOWN'
                                    ],
                                }
                            }
                        },
                        levelPercentage: {
                            type: Formats.INT,
                            min: 0,
                            max: 100
                        }
                    }
                };
                state_types['radioDiagnostics '] = {
                    type: Formats.OBJECT,
                    attributes: {
                        radioType: {
                            type: Formats.STRING,
                            values: ['WIFI', 'BLUETOOTH'],
                        },
                        signalStrength: {
                            type: Formats.OBJECT,
                            attributes: {
                                quality: {
                                    type: Formats.STRING,
                                    values: ['GOOD', 'FAIR', 'POOR']
                                },
                                rssiInDBM: {
                                    type: Formats.INT,
                                    min: -1000,
                                    max: 1000,
                                }
                            }
                        },
                        signalToNoiseRatio: {
                            type: Formats.OBJECT,
                            attributes: {
                                quality: {
                                    type: Formats.STRING,
                                    values: ['GOOD', 'FAIR', 'POOR']
                                },
                                snrInDB: {
                                    type: Formats.INT,
                                    min: 0,
                                    max: 1000,
                                }
                            }
                        }
                    }
                };
                state_types['radioDiagnostics'] = {
                    type: Formats.OBJECT,
                    attributes: {
                        quality: {
                            type: Formats.STRING,
                            values: ['GOOD', 'FAIR', 'POOR']
                        },
                        rssiInDBM: {
                            type: Formats.INT,
                            min: -1000,
                            max: 1000,
                        }
                    }
                }
                state_types['signalToNoiseRatio'] = {
                    type: Formats.OBJECT,
                    attributes: {
                        quality: {
                            type: Formats.STRING,
                            values: ['GOOD', 'FAIR', 'POOR']
                        },
                        snrInDB: {
                            type: Formats.INT,
                            min: 0,
                            max: 1000,
                        }
                    }
                };
                state_types['networkThroughput '] = {
                    type: Formats.OBJECT,
                    attributes: {
                        quality: {
                            type: Formats.STRING,
                            values: ['GOOD', 'FAIR', 'POOR']
                        },
                        bitsPerSecond: {
                            type: Formats.INT,
                            min: 0,
                        }
                    }
                };
            }

            // EqualizerController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-equalizercontroller.html
            if (node.config.i_equalizer_controller) {
                if (node.isVerbose()) node._debug("Alexa.EqualizerController");
                let properties = {};
                let configurations = {};
                if (node.config.bands.length > 0) {
                    let bands_supported = [];
                    let bands_value = [];
                    let attributes = [];
                    node.config.bands.forEach(band => {
                        bands_supported.push({
                            name: band
                        });
                        bands_value.push({
                            name: band,
                            value: 0
                        });
                    });
                    properties['bands'] = bands_value;
                    configurations['bands'] = {
                        supported: bands_supported,
                        range: {
                            minimum: node.to_int(node.config.band_range_min, -6),
                            maximum: node.to_int(node.config.band_range_max, 6)
                        }
                    }
                    state_types['bands'] = {
                        type: Formats.OBJECT + Formats.ARRAY,
                        attributes: {
                            name: {
                                type: Formats.STRING,
                                values: node.config.bands
                            },
                            value: {
                                type: Formats.INT + Formats.MANDATORY,
                                min: node.to_int(node.config.band_range_min, 0),
                                max: node.to_int(node.config.band_range_max, 10),
                            }
                        },
                    };
                }
                if (node.config.modes.length > 0) {
                    properties['mode'] = node.config.modes[0];
                    let modes_supported = [];
                    node.config.modes.forEach(mode => {
                        modes_supported.push({
                            name: mode
                        });
                    });
                    configurations['modes'] = {
                        supported: modes_supported
                    }
                    state_types['mode'] = {
                        type: Formats.STRING,
                        values: node.config.modes
                    };
                }
                node.addCapability("Alexa.EqualizerController", properties,
                    {
                        configurations: configurations
                    });
            }

            // EventDetectionSensor
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-eventdetectionsensor.html
            if (node.config.i_event_detection_sensor) {
                if (node.isVerbose()) node._debug("Alexa.EventDetectionSensor");
                node.addCapability("Alexa.EventDetectionSensor", {
                    humanPresenceDetectionState: {
                        value: 'NOT_DETECTED'
                    } // DETECTED
                    // TODO detectionMethods, media: { "type": "ALEXA.MEDIAMETADATA", "id": "<media metadata id>" }
                },
                    {
                        configuration: {
                            detectionMethods: [
                                "AUDIO",
                                "VIDEO"
                            ],
                            detectionModes: {
                                humanPresence: {
                                    featureAvailability: "ENABLED",
                                    supportsNotDetected: true
                                }
                            }
                        }
                    });
                state_types['humanPresenceDetectionState'] = {
                    type: Formats.OBJECT,
                    attributes: {
                        value: {
                            type: Formats.STRING,
                            values: ['DETECTED', 'NOT_DETECTED'],
                        },
                        detectionMethods: {
                            type: Formats.STRING + Formats.ARRAY,
                            values: ['AUDIO', 'VIDEO'],
                        },
                        media: {
                            type: Formats.OBJECT,
                            attributes: {
                                type: {
                                    type: Formats.STRING,
                                    values: ['ALEXA.MEDIAMETADATA']
                                },
                                id: {
                                    type: Formats.STRING,
                                    // TODO is_valid: a valid media id
                                }
                            }

                        },
                    }
                };
            }

            // InputController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-inputcontroller.html
            if (node.config.i_input_controller) {
                if (node.isVerbose()) node._debug("Alexa.InputController");
                let inputs = [];
                node.config.a_inputs.forEach(input => {
                    inputs.push({
                        name: input
                    })
                })
                node.addCapability("Alexa.InputController",
                    {
                        input: ''
                    },
                    {
                        inputs: inputs
                    }
                );
                state_types['input'] = {
                    type: Formats.STRING,
                    value: node.config.a_inputs,
                };
            }
            // InventoryLevelSensor
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-inventorylevelsensor.html

            // InventoryUsageSensor
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-inventoryusagesensor.html

            // KeypadController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-keypadcontroller.html
            if (node.config.i_keypad_controller) {
                if (node.isVerbose()) node._debug("Alexa.KeypadController");
                node.addCapability("Alexa.KeypadController", {}, {
                    keys: node.config.a_kc_keys
                });
            }

            // LockController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-lockcontroller.html
            if (node.config.i_lock_controller) {
                if (node.isVerbose()) node._debug("Alexa.LockController");
                node.addCapability("Alexa.LockController", {
                    lockState: 'LOCKED' // UNLOCKED JAMMED
                });
                state_types['lockState'] = {
                    type: Formats.STRING,
                    lockState: ['LOCKED', 'UNLOCKED', 'JAMMED'],
                };
            }

            // MediaMetadata
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-mediametadata.html
            if (node.config.i_media_metadata) {
                if (node.isVerbose()) node._debug("Alexa.MediaMetadata");
                node.media = [];
                node.addCapability("Alexa.MediaMetadata");
            }

            // ModeController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-modecontroller.html

            // MotionSensor
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-motionsensor.html
            if (node.config.i_motion_sensor) {
                if (node.isVerbose()) node._debug("Alexa.MotionSensor");
                node.addCapability("Alexa.MotionSensor", {
                    detectionState: 'NOT_DETECTED' // DETECTED
                });
                state_types['motionDetectionState'] = {
                    type: Formats.STRING,
                    values: ['DETECTED', 'NOT_DETECTED'],
                };
            }

            // PercentageController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-percentagecontroller.html
            if (node.config.i_percentage_controller) {
                if (node.isVerbose()) node._debug("Alexa.PercentageController");
                node.addCapability("Alexa.PercentageController", {
                    percentage: 0
                });
                state_types['percentage'] = {
                    type: Formats.INT,
                    min: 0,
                    max: 100,
                };
            }

            // PlaybackController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-playbackcontroller.html
            if (node.config.i_playback_controller) {
                if (node.isVerbose()) node._debug("Alexa.PlaybackController");
                node.addCapability("Alexa.PlaybackController", undefined, {
                    supportedOperations: node.config.a_playback_modes
                });
            }

            // PowerController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-powercontroller.html
            if (node.config.i_power_controller) {
                if (node.isVerbose()) node._debug("Alexa.PowerController");
                node.addCapability("Alexa.PowerController", {
                    powerState: 'OFF'
                });
                state_types['powerState'] = {
                    type: Formats.STRING,
                    lockState: ['ON', 'OFF'],
                };
            }

            // PowerLevelController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-powerlevelcontroller.html
            if (node.config.i_power_level_controller) {
                if (node.isVerbose()) node._debug("Alexa.PowerLevelController");
                node.addCapability("Alexa.PowerLevelController", {
                    powerLevel: 50
                });
                state_types['powerLevel'] = {
                    type: Formats.INT,
                    min: 0,
                    max: 100,
                };
            }

            // RangeController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-rangecontroller.html
            if (node.config.i_range_controller) {
                if (node.isVerbose()) node._debug("Alexa.RangeController");
                if (node.config.ranges !== undefined && node.config.ranges.length > 0) {
                    node.state["ranges"] = {};
                    let attributes = {};
                    state_types['ranges'] = {
                        type: Formats.OBJECT,
                        attributes: attributes,
                    };
                    node.config.ranges.forEach(range => {
                        if (range.instance && range.capability_resources) {
                            node.state["ranges"][range.instance] = node.to_int(range.min, 0);
                            attributes[range.instance] = {
                                type: Formats.INT + Formats.MANDATORY,
                                min: node.to_int(range.min, 0),
                                max: node.to_int(range.max, 100),
                            };
                            let additional_config = {
                                instance: range.instance,
                                capabilityResources: JSON.parse(range.capability_resources)
                            };
                            additional_config['configuration'] = {
                                supportedRange: {
                                    minimumValue: node.to_int(range.min, 0),
                                    maximumValue: node.to_int(range.max, 100),
                                    precision: node.to_int(range.precision, 1),
                                }
                            };
                            if (range.presets) {
                                const presets = JSON.parse(range.presets);
                                additional_config.configuration['presets'] = Array.isArray(presets) ? presets : [presets];
                            }
                            if (range.semantics) {
                                additional_config['semantics'] = JSON.parse(range.semantics);
                            }
                            node.addCapability("Alexa.RangeController",
                                {
                                    rangeValue: node.to_int(range.min, 0),
                                },
                                additional_config, true);
                        }
                    });
                }
            }

            // RTCSessionController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-rtcsessioncontroller.html

            // SceneController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-scenecontroller.html
            if (node.config.i_scene_controller) {
                if (node.isVerbose()) node._debug("Alexa.SceneController");
                node.addCapability("Alexa.SceneController", undefined, {
                    supportsDeactivation: true
                });
            }

            // SecurityPanelController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-securitypanelcontroller.html
            if (node.config.i_security_panel_controller) {
                if (node.isVerbose()) node._debug("Alexa.SecurityPanelController");
                node.security_device_names_in_error = [];
                const arm_state = node.config.arm_state || [];
                const alarms = node.config.alarms || [];
                const pin_code = node.config.pin_code || '';
                let configuration = {};
                if (arm_state.length > 0 || pin_code.trim().length === 4) {
                    let properties_value = {};
                    if (arm_state.length > 0) {
                        properties_value['armState'] = arm_state.includes('DISARMED') ? 'DISARMED' : arm_state[0];
                        configuration['supportedArmStates'] = arm_state.map(state => ({ "value": state }));
                    }
                    state_types['armState'] = {
                        type: Formats.STRING,
                        values: ['DISARMED', 'ARMED_AWAY', 'ARMED_STAY', 'ARMED_NIGHT'],
                    };
                    alarms.forEach(alarm => {
                        properties_value[alarm] = {
                            value: "OK"
                        };
                        state_types[alarm] = {
                            type: Formats.OBJECT,
                            attributes: {
                                value: {
                                    type: Formats.STRING,
                                    values: ['OK', 'ALARM'],
                                }
                            }
                        };
                    });
                    if (pin_code.trim().length === 4) {
                        configuration['supportedAuthorizationTypes'] = [{ type: 'FOUR_DIGIT_PIN' }];
                    }
                    node.addCapability("Alexa.SecurityPanelController", properties_value,
                        {
                            configuration: configuration
                        }
                    );
                }
            }

            // Speaker
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-speaker.html
            if (node.config.i_speaker) {
                if (node.isVerbose()) node._debug("Alexa.Speaker");
                node.addCapability("Alexa.Speaker", {
                    volume: 50,
                    muted: false
                });
                state_types['volume'] = {
                    type: Formats.INT,
                    min: 0,
                    max: 100,
                };
                state_types['muted'] = {
                    type: Formats.BOOL,
                };
            }

            // StepSpeaker
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-stepspeaker.html
            if (node.config.i_step_speaker) {
                if (node.isVerbose()) node._debug("Alexa.StepSpeaker");
                node.addCapability("Alexa.StepSpeaker");
            }

            // TemperatureSensor
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-temperaturesensor.html
            if (node.config.i_temperature_sensor) {
                if (node.isVerbose()) node._debug("Alexa.TemperatureSensor");
                node.addCapability("Alexa.TemperatureSensor", {
                    temperature: {
                        value: 19.9,
                        scale: "CELSIUS" // FAHRENHEIT KELVIN
                    }
                });
                state_types['temperature'] = {
                    type: Formats.OBJECT,
                    attributes: {
                        value: {
                            type: Formats.FLOAT,
                        },
                        scale: {
                            type: Formats.STRING,
                            values: ['CELSIUS', 'FAHRENHEIT', 'KELVIN'],
                        }
                    }
                };
            }

            // ThermostatController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-thermostatcontroller.html
            if (node.config.i_thermostat_controller) {
                if (node.isVerbose()) node._debug("Alexa.ThermostatController");
                let properties = {};
                if (node.config.a_target_setpoint) {
                    properties.targetSetpoint = {
                        value: 20.1,
                        scale: "CELSIUS"
                    };
                    state_types['targetSetpoint'] = {
                        type: Formats.OBJECT,
                        attributes: {
                            value: {
                                type: Formats.FLOAT,
                            },
                            scale: {
                                type: Formats.STRING,
                                values: ['CELSIUS', 'FAHRENHEIT', 'KELVIN'],
                            }
                        },
                        exclusive_states: ['lowerSetpoint', 'upperSetpoint']
                    };
                }
                if (node.config.a_lower_setpoint) {
                    properties.lowerSetpoint = {
                        value: 20.1,
                        scale: "CELSIUS"
                    };
                    state_types['lowerSetpoint'] = {
                        type: Formats.OBJECT,
                        attributes: {
                            value: {
                                type: Formats.FLOAT,
                            },
                            scale: {
                                type: Formats.STRING,
                                values: ['CELSIUS', 'FAHRENHEIT', 'KELVIN'],
                            }
                        },
                        exclusive_states: ['targetSetpoint']
                    };
                }
                if (node.config.a_upper_setpoint) {
                    properties.upperSetpoint = {
                        value: 20.1,
                        scale: "CELSIUS"
                    };
                    state_types['upperSetpoint'] = {
                        type: Formats.OBJECT,
                        attributes: {
                            value: {
                                type: Formats.FLOAT,
                            },
                            scale: {
                                type: Formats.STRING,
                                values: ['CELSIUS', 'FAHRENHEIT', 'KELVIN'],
                            }
                        },
                        exclusive_states: ['targetSetpoint']
                    };
                }
                if (node.config.a_modes.length > 1) {
                    properties.thermostatMode = node.config.a_modes.includes('OFF') ? 'OFF' : node.config.a_modes[0];
                    state_types['thermostatMode'] = {
                        type: Formats.STRING,
                        values: node.config.a_modes,
                    };
                }
                node.addCapability("Alexa.ThermostatController",
                    properties,
                    {
                        configuration: {
                            supportedModes: node.config.a_modes,
                            supportsScheduling: node.config.a_supports_scheduling
                        }
                    }
                );
                /*delete node.state.thermostat_mode;
                node.state['schedule'] = {
                    start: "",
                    duration: ""
                };*/
            }

            // ThermostatController.HVAC.Components
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-thermostatcontroller-hvac-components.html
            if (node.config.i_thermostat_controller_hvac_components) {
                if (node.isVerbose()) node._debug("Alexa.ThermostatController.HVAC.Components");
                let properties = {};
                let configurations = {};
                let add_interface = false;
                if (node.config.primary_heater_operation) {
                    properties['primaryHeaterOperation'] = 'OFF';
                    configurations['numberOfPrimaryHeaterOperations'] = parseInt(node.config.primary_heater_operation.substr(node.config.primary_heater_operation.length - 1));
                    add_interface = true;
                    state_types['primaryHeaterOperation'] = {
                        type: Formats.STRING,
                        values: ['OFF', 'STAGE_1', 'STAGE_2', 'STAGE_3'].slice(0, 1 + configurations['numberOfPrimaryHeaterOperations']),
                    };
                }
                if (node.config.auxiliary_heater_operation) {
                    properties['auxiliaryHeaterOperation'] = 'OFF';
                    add_interface = true;
                    state_types['auxiliaryHeaterOperation'] = {
                        type: Formats.STRING,
                        values: ['ON', 'OFF'],
                    };
                }
                if (node.config.cooler_operation) {
                    properties['coolerOperation'] = 'OFF';
                    configurations['numberOfCoolerOperations'] = parseInt(node.config.cooler_operation.substr(node.config.cooler_operation.length - 1));
                    add_interface = true;
                    state_types['coolerOperation'] = {
                        type: Formats.STRING,
                        values: ['OFF', 'STAGE_1', 'STAGE_2', 'STAGE_3'].slice(0, 1 + configurations['numberOfCoolerOperations']),
                    };
                }
                if (node.config.fan_operation) {
                    properties['fanOperation'] = 'OFF';
                    configurations['numberOfFanOperations'] = parseInt(node.config.fan_operation.substr(node.config.fan_operation.length - 1));
                    add_interface = true;
                    state_types['fanOperation'] = {
                        type: Formats.STRING,
                        values: ['OFF', 'STAGE_1', 'STAGE_2', 'STAGE_3'].slice(0, 1 + configurations['numberOfFanOperations']),
                    };
                }
                if (add_interface) {
                    node.addCapability("ThermostatController.HVAC.Components", properties, {
                        configuration: configurations
                    });
                }
            }

            // ToggleController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-togglecontroller.html
            if (node.config.i_toggle_controller) {
                if (node.isVerbose()) node._debug("Alexa.ToggleController");
                if (node.config.toggles.length > 0) {
                    node.state["toggles"] = {};
                    let attributes = {};
                    state_types['toggles'] = {
                        type: Formats.OBJECT,
                        attributes: attributes
                    };
                    node.config.toggles.forEach(toggle => {
                        if (toggle.instance && toggle.capability_resources) {
                            node.state["toggles"][toggle.instance] = "OFF";
                            attributes[toggle.instance] = {
                                type: Formats.STRING + Formats.MANDATORY,
                                values: ['ON', 'OFF'],
                            };
                            let additional_config = {
                                instance: toggle.instance,
                                capabilityResources: JSON.parse(toggle.capability_resources)
                            };
                            if (toggle.semantics) {
                                additional_config['semantics'] = JSON.parse(toggle.semantics);
                            }
                            node.addCapability("Alexa.ToggleController",
                                {
                                    toggleState: 'OFF'
                                },
                                additional_config, true);
                        }
                    });
                }
            }

            // WakeOnLANController
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-wakeonlancontroller.html
            if (node.config.i_wake_on_lan_controller) {
                if (node.isVerbose()) node._debug("Alexa.WakeOnLANController");
                if (node.config.mac_addresses.length > 0) {
                    node.addCapability("Alexa.WakeOnLANController", undefined, {
                        configuration: {
                            mac_addresses: node.config.mac_addresses
                        }
                    });
                }
            }

            if (node.isVerbose()) node._debug("name " + JSON.stringify(node.name));
            if (node.isVerbose()) node._debug("capabilities " + JSON.stringify(node.capabilities));
            if (node.isVerbose()) node._debug("properties " + JSON.stringify(node.getProperties()));
            if (node.isVerbose()) node._debug("state " + JSON.stringify(node.state));
            if (node.isVerbose()) node._debug("state_types " + JSON.stringify(node.state_types));
        }

        getEndpoint() {
            const node = this;
            let endpoint = {
                "endpointId": node.config.id,
                "manufacturerName": "Node-RED",
                "description": node.device_desc + " " + node.config.name + " by Node-RED",
                "friendlyName": node.config.name,
                "displayCategories": node.config.display_categories,
                "additionalAttributes": {
                    "manufacturer": "Node-RED",
                    "model": node.device_desc,
                },
                "capabilities": node.capabilities,
                "connections": [],
                "relationships": {},
                "cookie": {}
            };
            return endpoint;
        }

        //
        //
        //
        //
        getCapability(iface, properties_val, no_state) {
            const node = this;
            let capability = {
                type: "AlexaInterface",
                interface: iface,
                version: DEFAULT_PAYLOAD_VERSION,
            };
            if (properties_val) {
                let supported = [];
                Object.keys(properties_val).forEach(key => {
                    const mapped_key = node.alexa.get_mapped_property(iface, key);
                    if (no_state !== true) {
                        node.state[mapped_key] = properties_val[key];
                    }
                    supported.push({
                        name: key
                    });
                });
                capability['properties'] = {
                    supported: supported,
                    proactivelyReported: true,
                    retrievable: true,
                    nonControllable: false
                };
            }
            return capability;
        }

        //
        //
        //
        //
        addCapability(iface, properties_val, attributes, no_state) {
            const node = this;
            let capability = node.getCapability(iface, properties_val, no_state);
            if (attributes !== undefined) {
                Object.assign(capability, attributes);
            }
            node.capabilities.push(capability);
            return capability;
        }

        //
        //
        //
        //
        // https://developer.amazon.com/en-US/docs/alexa/device-apis/list-of-interfaces.html
        execDirective(header, payload, cmd_res) { // Directive
            const node = this;
            const namespace = header['namespace'];
            const name = header['name'];
            const instance = header['instance'];
            if (node.isVerbose()) node._debug("execDirective state before " + name + "/" + namespace + " " + JSON.stringify(node.state));
            let modified = undefined;
            let send_state_in_out = true;
            let event_payload = {};
            let res_payload = {};
            let other_data = {};
            cmd_res['event'] = {
                payload: event_payload
            }
            cmd_res['payload'] = res_payload;
            cmd_res['name'] = 'Response';
            cmd_res['namespace'] = 'Alexa';

            switch (namespace) {
                case "Alexa.BrightnessController": // BrightnessController
                    if (name === 'SetBrightness') {
                        modified = node.setValues(payload, node.state);
                    } else if (name === 'AdjustBrightness') {
                        const modified = node.setValues({
                            brightness: node.state['brightness'] + payload.brightnessDelta
                        }, node.state);
                    }
                    break;

                case "Alexa.CameraStreamController": // CameraStreamController
                    if (name === 'InitializeCameraStreams') {
                        modified = [];
                        cmd_res['namespace'] = namespace;
                        const cameraStreams = payload.cameraStreams;
                        if (node.isVerbose()) node._debug("CCHI cameraStreams " + node.id + " " + JSON.stringify(node.cameraStreams));
                        if (node.isVerbose()) node._debug("CCHI payload " + node.id + " " + JSON.stringify(payload));
                        let css = [];
                        if (node.cameraStreams && node.cameraStreams.cameraStreams && node.cameraStreams.cameraStreams.length > 0) {
                            node.cameraStreams.cameraStreams.forEach(acs => {
                                cameraStreams.forEach(rcs => {
                                    if (acs.protocol === rcs.protocol &&
                                        acs.resolution.width === rcs.resolution.width &&
                                        acs.resolution.height === rcs.resolution.height &&
                                        acs.authorizationType === rcs.authorizationType &&
                                        acs.videoCodec === rcs.videoCodec &&
                                        acs.audioCodec === rcs.audioCodec
                                    ) {
                                        css.push({
                                            uri: acs.uri,
                                            expirationTime: acs.expirationTime,
                                            idleTimeoutSeconds: acs.idleTimeoutSeconds,
                                            protocol: acs.protocol,
                                            resolution: {
                                                width: acs.resolution.width,
                                                height: acs.resolution.height,
                                            },
                                            authorizationType: acs.authorizationType,
                                            videoCodec: acs.videoCodec,
                                            audioCodec: acs.audioCodec
                                        });
                                    }
                                });
                            });
                            if (css.length > 0) {
                                event_payload.cameraStreams = css;
                                event_payload.imageUri = node.cameraStreams.imageUri || '';
                            }
                        }
                    }
                case "Alexa.ChannelController": // ChannelController
                    if (name === 'ChangeChannel') {
                        modified = node.setValues(payload, node.state);
                    }
                    else if (name === 'SkipChannels') {
                        const channelCount = payload.channelCount;
                        // TODO, search current channel, increase by channelCount, set it
                        const new_channel = {
                            number: "7",
                            callSign: "CBS",
                            affiliateCallSign: "KIRO"
                        };
                        modified = [];
                    }
                    break;

                case "Alexa.ColorController": // ColorController
                    if (name === 'SetColor') {
                        modified = node.setValues(payload, node.state);
                    }
                    break;

                case "Alexa.ColorTemperatureController": // ColorTemperatureController
                    if (name === 'SetColorTemperature') {
                        modified = node.setValues(payload, node.state);
                    }
                    else if (name === 'IncreaseColorTemperature') {
                        modified = node.setValues({
                            brightness: node.state['colorTemperatureInKelvin'] + 100
                        }, node.state);
                    }
                    else if (name === 'DecreaseColorTemperature') {
                        modified = node.setValues({
                            brightness: node.state['colorTemperatureInKelvin'] - 100
                        }, node.state);
                    }
                    break;
                case "Alexa.DeviceUsage.Meter": // DeviceUsage.Meter
                    if (name === 'ReportMeasurements') {
                        modified = [];
                        other_data['correlationToken'] = header['correlationToken'];
                    } else if (name === 'ReduceResolution') {
                        modified = [];
                        other_data['correlationToken'] = header['correlationToken'];
                    } else if (name === 'InvalidMeasurementError') {
                        modified = [];
                        other_data['correlationToken'] = header['correlationToken'];
                    }
                    break;

                case "Alexa.EqualizerController": // EqualizerController
                    if (name === 'SetMode') {
                        modified = node.setValues(payload, node.state);
                    } else if (name === 'SetBands') {
                        modified = node.setValues(payload, node.state);
                    }
                    break;

                case "Alexa.MediaMetadata": // MediaMetadata
                    if (name === 'GetMediaMetadata') {
                        cmd_res['namespace'] = namespace;
                        cmd_res['name'] = name + '.Response';
                        if (node.isVerbose()) node._debug("execDirective node.media " + name + "/" + namespace + " " + JSON.stringify(node.media));
                        modified = []; // TODO
                        if (payload.filters && Array.isArray(payload.filters.mediaIds)) {
                            event_payload.media = [];
                            node.media.forEach(m => {
                                if (payload.filters.mediaIds.includes(m.id)) {
                                    event_payload.media.push(m);
                                }
                            });
                            const current_media_id = node.media.map(m => m.id);
                            event_payload.errors = [];
                            payload.filters.mediaIds.forEach(id => {
                                if (!current_media_id.includes(id)) {
                                    event_payload.errors.push({
                                        mediaId: id,
                                        status: "NOT_FOUND"
                                    });
                                }
                            });
                        } else {
                            event_payload.media = node.media;
                        }
                    }
                    break;

                case "Alexa.InputController": // InputController
                    if (name === 'SelectInput') {
                        modified = node.setValues(payload, node.state);
                    }
                    break;

                case "Alexa.KeypadController": // KeypadController
                    if (name === 'SendKeystroke') {
                        modified = [];
                    }
                    break;

                case "Alexa.LockController": // LockController
                    // TODO DeferredResponse
                    // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-response.html#deferred
                    if (name === 'Lock') {
                        modified = node.setValues({
                            lockState: 'LOCKED'
                        }, node.state);
                    }
                    else if (name === 'Unlock') {
                        modified = node.setValues({
                            lockState: 'UNLOCKED'
                        }, node.state);
                    }
                    break;

                case "Alexa.PercentageController": // PercentageController
                    if (name === 'SetPercentage') {
                        modified = node.setValues(payload, node.state);
                    } else if (name === 'AdjustPercentage') {
                        modified = node.setValues({
                            percentage: node.state['percentage'] - payload['percentageDelta']
                        }, node.state);
                    }
                    break;

                case "Alexa.PowerController": // PowerController
                    if (name === 'TurnOn') {
                        if (node.config.i_wake_on_lan_controller) {
                            cmd_res["name"] = "DeferredResponse";
                            event_payload['estimatedDeferralInSeconds'] = 15;
                            modified = [];
                            send_state_in_out = false;
                            process.nextTick(() => {
                                if (node.isVerbose()) node._debug("execDirective send_change_report");
                                // TODO manage response
                                node.alexa.send_change_report(node.id, [], "VOICE_INTERACTION", undefined, 'Alexa.WakeOnLANController', 'WakeUp')
                                    .then(res => {
                                        if (node.isVerbose()) node._debug("execDirective send_change_report for WakeUp OK");
                                        modified = node.setValues({
                                            powerState: 'ON'
                                        }, node.state);
                                        node.sendState(modified, payload, namespace, name);
                                        node.alexa.send_change_report(node.id, [], "VOICE_INTERACTION", {
                                            event: {
                                                header: {
                                                    correlationToken: header.correlationToken
                                                }
                                            }
                                        }, 'Alexa', 'Response')
                                            .then(() => { });
                                    })
                                    .catch(() => {
                                        if (node.isVerbose()) node._debug("execDirective send_change_report for WakeUp ERROR");
                                        node.alexa.send_error_response(undefined, undefined, node.id, 'INTERNAL_ERROR', 'Unknown error');
                                    });
                            });
                        } else {
                            modified = node.setValues({
                                powerState: 'ON'
                            }, node.state);
                        }
                    }
                    else if (name === 'TurnOff') {
                        modified = node.setValues({
                            powerState: 'OFF'
                        }, node.state);
                    }
                    break;

                case "Alexa.PlaybackController": // PlaybackController
                    if (node.config.a_playback_modes.includes(name)) {
                        modified = []
                    }
                    break;


                case "Alexa.PowerLevelController": // PowerLevelController
                    if (name === 'AdjustPowerLevel') {
                        modified = []
                    }
                    break;

                case "Alexa.SceneController": // SceneController
                    cmd_res['namespace'] = 'Alexa.SceneController';
                    if (name === 'Activate') {
                        modified = [];
                        cmd_res['name'] = 'ActivationStarted';
                    }
                    else if (name === 'Deactivate') {
                        modified = [];
                        cmd_res['name'] = 'DeactivationStarted';
                    }
                    event_payload['cause'] = {
                        type: "VOICE_INTERACTION"

                    };
                    event_payload['timestamp'] = new Date().toISOString();
                    break;

                case "Alexa.SecurityPanelController": // SecurityPanelController
                    if (name === 'Arm') {
                        cmd_res['namespace'] = 'Alexa.SecurityPanelController';
                        cmd_res['name'] = 'Arm.Response';
                        if (node.state['armState'] === payload['armState']) {
                            modified = [];
                        } else if (node.state['armState'] === 'DISARMED') {
                            node._debug("CCHI event_payload security_device_names_in_error " + JSON.stringify(node.security_device_names_in_error));
                            if (node.security_device_names_in_error.length > 0) {
                                let security_device_in_error = [];
                                for (const [id, name] of Object.entries(node.alexa.get_devices_id_name(node.security_device_names_in_error))) {
                                    security_device_in_error.push({
                                        friendlyName: name,
                                        endpointId: id
                                    });
                                }
                                if ('BYPASS_ALL' === (payload['bypassType'] || '')) {
                                    event_payload['bypassedEndpoints'] = security_device_in_error;
                                    modified = node.setValues({ armState: payload['armState'] }, node.state);
                                    const exit_delay = parseInt(node.config.exit_delay || 0);
                                    if (exit_delay > 0) {
                                        event_payload['exitDelayInSeconds'] = exit_delay;
                                    }
                                } else {
                                    event_payload['endpointsNeedingBypass'] = security_device_in_error;
                                    cmd_res['name'] = 'ErrorResponse';
                                    event_payload['type'] = 'BYPASS_NEEDED';
                                    event_payload['message'] = 'The security panel has open zones that the user must bypass.';
                                    modified = [];
                                }
                            } else {
                                modified = node.setValues({ armState: payload['armState'] }, node.state);
                                const exit_delay = parseInt(node.config.exit_delay || 0);
                                if (exit_delay > 0) {
                                    event_payload['exitDelayInSeconds'] = exit_delay;
                                }
                            }
                        } else {
                            cmd_res['name'] = 'ErrorResponse';
                            event_payload['type'] = 'AUTHORIZATION_REQUIRED';
                            event_payload['message'] = 'The security panel is already armed.';
                            modified = [];
                        }
                    }
                    else if (name === 'Disarm') {
                        cmd_res['namespace'] = 'Alexa';
                        cmd_res['name'] = 'Response';
                        if (node.state['armState'] === 'DISARMED') {
                            modified = [];
                        } else if (node.config.pin_code.trim().length > 0) {
                            if (payload.authorization && payload.authorization.type === 'FOUR_DIGIT_PIN' && payload.authorization.value === node.config.pin_code) {
                                modified = node.setValues({ armState: 'DISARMED' }, node.state);
                                // TODO Check Add alarms if any
                            } else {
                                cmd_res['name'] = 'ErrorResponse';
                                event_payload['type'] = 'UNAUTHORIZED';
                                event_payload['message'] = 'The PIN code is missing or not correct.';
                                modified = [];
                            }
                        } else {
                            modified = node.setValues({ armState: 'DISARMED' }, node.state);
                            // TODO Check Add alarms if any??
                        }
                    }
                    break;

                case "Alexa.RangeController": // RangeController
                    if (name === 'SetRangeValue') {
                        let ranges = {};
                        ranges[instance] = payload['rangeValue'];
                        modified = node.setValues({
                            ranges: ranges
                        }, node.state);
                        if (modified.length > 0) {
                            modified = [{
                                ranges: [instance]
                            }];
                        }
                    } else if (name === 'AdjustRangeValue') {
                        const range = node.config.ranges.filter(range => range.instance === instance)[0];
                        const new_value = node.state.ranges[instance] + (payload['rangeValueDeltaDefault'] ? node.to_int(range.precision, 1) : payload['rangeValueDelta']);
                        if (new_value >= node.to_int(range.min, 0) && new_value <= node.to_int(range.max, 100)) {
                            let ranges = {};
                            ranges[instance] = new_value;
                            modified = node.setValues({
                                ranges: ranges
                            }, node.state);
                            if (modified.length > 0) {
                                modified = [{
                                    ranges: [instance]
                                }];
                            }
                        } // ELSE TODO send error
                    }
                    break;

                case "Alexa.Speaker": // Speaker
                    if (name === 'SetVolume') {
                        modified = node.setValues(payload, node.state);
                    }
                    else if (name === 'AdjustVolume') {
                        modified = node.setValues({
                            volume: node.state['volume'] + payload['volume']
                        }, node.state);
                    }
                    else if (name === 'SetMute') {
                        modified = node.setValues(payload, node.state);
                    }
                    break;

                case "Alexa.StepSpeaker": // StepSpeaker
                    if (name === 'AdjustVolume') {
                        modified = [];
                    }
                    break;

                case "Alexa.ThermostatController": // ThermostatController
                    if (name === 'SetTargetTemperature') {
                        modified = node.setValues(payload, node.state);
                        /*
                        if (payload.targetSetpoint === undefined) {
                            delete node.state.targetSetpoint;
                        }
                        if (payload.lowerSetpoint === undefined) {
                            delete node.state.lowerSetpoint;
                        }
                        if (payload.upperSetpoint === undefined) {
                            delete node.state.upperSetpoint;
                        }
                        */
                    }
                    else if (name === 'AdjustTargetTemperature') {
                        modified = []
                        if (typeof payload.targetSetpoint.value === 'number' && typeof node.state.targetSetpoint.value === 'number') {
                            // TODO check scale
                            node.state.targetSetpoint.value += payload.targetSetpoint.value;
                            modified.push('targetSetpoint');
                        }
                        if (typeof payload.lowerSetpoint.value === 'number' && typeof node.state.lowerSetpoint.value === 'number') {
                            // TODO check scale
                            node.state.lowerSetpoint.value += payload.lowerSetpoint.value;
                            modified.push('lowerSetpoint');
                        }
                        if (typeof payload.upperSetpoint.value === 'number' && typeof node.state.upperSetpoint.value === 'number') {
                            // TODO check scale
                            node.state.upperSetpoint.value += payload.upperSetpoint.value;
                            modified.push('upperSetpoint');
                        }
                    }
                    else if (name === 'SetThermostatMode') {
                        modified = node.setValues({
                            thermostatMode: payload.thermostatMode.value
                        }, node.state);
                    }
                    else if (name === 'ResumeSchedule') {
                        modified = []
                    }
                    break;

                case "Alexa.ToggleController": // ToggleController
                    if (name === 'TurnOn' || name === 'TurnOff') {
                        let toggles = {};
                        toggles[instance] = name === 'TurnOn' ? 'ON' : 'OFF';
                        modified = node.setValues({
                            toggles: toggles
                        }, node.state);
                        if (modified.length > 0) {
                            modified = [{
                                toggles: [instance]
                            }];
                        }
                    }
                    break;

                default:
                    node.error("execDirective invalid directive " + name + "/" + namespace);
            }


            if (send_state_in_out && modified !== undefined) {
                node.sendState(modified, payload, namespace, name, other_data);
            }

            if (node.isVerbose()) node._debug("execDirective event_payload " + name + "/" + namespace + " " + JSON.stringify(event_payload));
            if (node.isVerbose()) node._debug("execDirective modified after " + name + "/" + namespace + " " + JSON.stringify(modified));
            if (node.isVerbose()) node._debug("execDirective state after " + name + "/" + namespace + " " + JSON.stringify(node.state));
            return modified;
        }

        //
        //
        //
        //
        sendState(modified, inputs, namespace, name, other_data) {
            const node = this;
            if (modified === undefined) {
                modified = [];
            }
            if (inputs === undefined) {
                inputs = {};
            }
            let msg = {
                inputs: inputs,
                payload: node.state,
                modified: modified,
                topic: node.config.topic,
                device: node.config.name
            };
            if (name) {
                msg.name = name;
            }
            if (namespace) {
                msg.namespace = namespace;
            }
            node.alexa.objectMerge(msg, other_data);
            node.send(msg);
            return node.state;
        }

        //
        //
        //
        //
        // https://developer.amazon.com/en-US/docs/alexa/device-apis/list-of-interfaces.html
        getProperties() {
            const node = this;
            const uncertainty = 500;
            let properties = [];
            const time_of_sample = (new Date()).toISOString();
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-automationmanagement.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-brightnesscontroller.html
            // BrightnessController
            if (node.config.i_brightness_controller) {
                properties.push({
                    namespace: "Alexa.BrightnessController",
                    name: "brightness",
                    value: node.state['brightness'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-camerastreamcontroller.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-channelcontroller.html
            if (node.config.i_channel_controller) {
                if (node.state['channel'] !== undefined) {
                    properties.push({
                        namespace: "Alexa.ChannelController",
                        name: "channel",
                        value: node.state['channel'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                if (node.state['channelMetadata'] !== undefined) {
                    properties.push({
                        namespace: "Alexa.ChannelController",
                        name: "channelMetadata",
                        value: node.state['channelMetadata'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-colorcontroller.html
            // ColorController
            if (node.config.i_color_controller) {
                if (node.state['color'] !== undefined) {
                    properties.push({
                        namespace: "Alexa.ColorController",
                        name: "color",
                        value: node.state['color'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-colortemperaturecontroller.html
            // ColorTemperatureController
            if (node.config.i_color_temperature_controller) {
                if (node.state['colorTemperatureInKelvin'] !== undefined) {
                    properties.push({
                        namespace: "Alexa.ColorTemperatureController",
                        name: "colorTemperatureInKelvin",
                        value: node.state['colorTemperatureInKelvin'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-contactsensor.html
            // ContactSensor
            if (node.config.i_contact_sensor) {
                properties.push({
                    namespace: "Alexa.ContactSensor",
                    name: "detectionState",
                    value: node.state['contactDetectionState'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-doorbelleventsource.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-endpointhealth.html
            // EndpointHealth
            if (node.config.i_endpoint_health) {
                properties.push({
                    namespace: "Alexa.EndpointHealth",
                    name: "connectivity",
                    value: node.state['connectivity'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-equalizercontroller.html
            // EqualizerController
            if (node.config.i_equalizer_controller) {
                if (typeof node.state['bands'] === 'object') {
                    properties.push({
                        namespace: "Alexa.EqualizerController",
                        name: "bands",
                        value: node.state['bands'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                if (typeof node.state['mode'] === 'string') {
                    properties.push({
                        namespace: "Alexa.EqualizerController",
                        name: "mode",
                        value: node.state['mode'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
            }

            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-deviceusage-estimation.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-eventdetectionsensor.html
            if (node.config.i_event_detection_sensor) {
                properties.push({
                    namespace: "Alexa.EventDetectionSensor",
                    name: "humanPresenceDetectionState",
                    value: node.state['inhumanPresenceDetectionStateput'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-inputcontroller.html
            if (node.config.i_input_controller) {
                properties.push({
                    namespace: "Alexa.InputController",
                    name: "input",
                    value: node.state['input'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-inventorylevelsensor.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-inventoryusagesensor.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-keypadcontroller.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-lockcontroller.html
            // LockController
            if (node.config.i_lock_controller) {
                properties.push({
                    namespace: "Alexa.LockController",
                    name: "lockState",
                    value: node.state['lockState'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-mediametadata.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-deviceusage-meter.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-modecontroller.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-motionsensor.html
            // MotionSensor
            if (node.config.i_motion_sensor) {
                properties.push({
                    namespace: "Alexa.MotionSensor",
                    name: "detectionState",
                    value: node.state['motionDetectionState'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-percentagecontroller.html
            // PercentageController
            if (node.config.i_percentage_controller) {
                properties.push({
                    namespace: "Alexa.PercentageController",
                    name: "percentage",
                    value: node.state['percentage'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-playbackcontroller.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-powercontroller.html
            // PowerController
            if (node.config.i_power_controller || node.config.i_wake_on_lan_controller) {
                properties.push({
                    namespace: "Alexa.PowerController",
                    name: "powerState",
                    value: node.state['powerState'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }

            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-powerlevelcontroller.html
            if (node.config.i_power_level_controller) {
                properties.push({
                    namespace: "Alexa.PowerLevelController",
                    name: "powerLevel",
                    value: node.state['powerLevel'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }

            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-rangecontroller.html
            if (node.config.i_range_controller) {
                for (const [range, value] of Object.entries(node.state.ranges || [])) {
                    properties.push({
                        namespace: "Alexa.RangeController",
                        instance: range,
                        name: "rangeValue",
                        value: value,
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
            }

            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-rtcsessioncontroller.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-scenecontroller.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-securitypanelcontroller.html
            // SecurityPanelController
            if (node.config.i_security_panel_controller) {
                if (node.state['armState']) {
                    properties.push({
                        namespace: "Alexa.SecurityPanelController",
                        name: "armState",
                        value: node.state['armState'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                node.config.alarms.forEach(alarm => {
                    properties.push({
                        namespace: "Alexa.SecurityPanelController",
                        name: alarm,
                        value: node.state[alarm],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                });
            }

            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-speaker.html
            if (node.config.i_speaker) {
                properties.push({
                    namespace: "Alexa.Speaker",
                    name: "volume",
                    value: node.state['volume'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-stepspeaker.html
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-temperaturesensor.html
            // TemperatureSensor
            if (node.config.i_temperature_sensor) {
                properties.push({
                    namespace: "Alexa.TemperatureSensor",
                    name: "temperature",
                    value: node.state['temperature'],
                    timeOfSample: time_of_sample,
                    uncertaintyInMilliseconds: uncertainty,
                });
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-thermostatcontroller.html
            // ThermostatController
            if (node.config.i_thermostat_controller) {
                if (node.state.targetSetpoint !== undefined) {
                    properties.push({
                        namespace: "Alexa.ThermostatController",
                        name: "targetSetpoint",
                        value: node.state['targetSetpoint'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                if (node.state.lowerSetpoint !== undefined) {
                    properties.push({
                        namespace: "Alexa.ThermostatController",
                        name: "lowerSetpoint",
                        value: node.state['lowerSetpoint'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                if (node.state.upperSetpoint !== undefined) {
                    properties.push({
                        namespace: "Alexa.ThermostatController",
                        name: "upperSetpoint",
                        value: node.state['upperSetpoint'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                if (node.state.thermostatMode !== undefined) {
                    properties.push({
                        namespace: "Alexa.ThermostatController",
                        name: "thermostatMode",
                        value: node.state['thermostatMode'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-thermostatcontroller-hvac-components.html
            if (node.config.i_thermostat_controller_hvac_components) {
                if (node.state.primaryHeaterOperation !== undefined) {
                    properties.push({
                        namespace: "Alexa.ThermostatController.HVAC.Components",
                        name: "primaryHeaterOperation",
                        value: node.state['primaryHeaterOperation'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                if (node.state.auxiliaryHeaterOperation !== undefined) {
                    properties.push({
                        namespace: "Alexa.ThermostatController.HVAC.Components",
                        name: "auxiliaryHeaterOperation",
                        value: node.state['auxiliaryHeaterOperation'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                if (node.state.primaryHeaterOperation !== undefined) {
                    properties.push({
                        namespace: "Alexa.ThermostatController.HVAC.Components",
                        name: "coolerOperation",
                        value: node.state['coolerOperation'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
                if (node.state.primaryHeaterOperation !== undefined) {
                    properties.push({
                        namespace: "Alexa.ThermostatController.HVAC.Components",
                        name: "fanOperation",
                        value: node.state['fanOperation'],
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-togglecontroller.html
            if (node.config.i_toggle_controller) {
                for (const [toggle, value] of Object.entries(node.state.toggles)) {
                    properties.push({
                        namespace: "Alexa.ToggleController",
                        instance: toggle,
                        name: "toggleState",
                        value: value,
                        timeOfSample: time_of_sample,
                        uncertaintyInMilliseconds: uncertainty,
                    });
                }
            }
            // https://developer.amazon.com/en-US/docs/alexa/device-apis/alexa-wakeonlancontroller.html
            return properties;
        }

        //
        //
        //
        //
        updateStatusIcon() {
            const node = this;
            let text = '';
            let fill = 'blue';
            let shape = 'dot';
            if (node.state.connectivity && node.state.connectivity.value !== undefined) {
                if (node.state.connectivity.value === 'OK') {
                    fill = 'green';
                } else {
                    fill = 'red';
                }
            }
            if (node.state.powerState !== undefined) {
                if (node.state.powerState === 'ON') {
                    text = 'ON';
                } else {
                    text = 'OFF';
                }
            }
            if (node.state.powerLevel !== undefined) {
                text += " P: " + node.state.powerLevel;
            }
            if (node.state.brightness !== undefined) {
                text += " bri: " + node.state.brightness;
            }
            if (node.state.colorTemperatureInKelvin !== undefined) {
                text += ' temp: ' + node.state.colorTemperatureInKelvin;
            }
            if (node.state.color !== undefined) {
                text += ' H: ' + node.state.color.hue +
                    ' S: ' + node.state.color.saturation +
                    ' B: ' + node.state.color.brightness;
            }
            if (node.state.lockState !== undefined) {
                text += ' ' + node.state.lockState;
            }
            if (node.state.armState !== undefined) {
                text += ' ' + node.state.armState;
            }
            if (node.state.percentage !== undefined) {
                text += ' ' + node.state.percentage + "% ";
            }
            if (node.state.volume !== undefined) {
                text += ' vol: ' + node.state.volume;
            }
            if (node.state.muted !== undefined && node.state.muted) {
                text += ' M';
            }
            if (node.state.temperature !== undefined) {
                text += ' T: ' + node.state.temperature.value;
            }
            if (node.state.targetSetpoint !== undefined) {
                text += ' TS: ' + node.state.targetSetpoint.value;
            }

            if (node.state.lowerSetpoint !== undefined && node.state.upperSetpoint !== undefined) {
                text += ' TS: [' + node.state.lowerSetpoint.value + ',' + node.state.upperSetpoint.value + ']';
            }

            if (node.state.motionDetectionState !== undefined) {
                text += node.state.motionDetectionState === 'DETECTED' ? ' MOTION' : ' NO MOTION';
            }

            if (node.state.contactDetectionState !== undefined) {
                text += node.state.contactDetectionState === 'DETECTED' ? ' CONTACT' : ' NO CONTACT';
            }
            if (node.state.connectivity !== undefined) {
                if (node.state.connectivity.value === 'UNREACHABLE') {
                    fill = 'red';
                } else if (fill !== 'red') {
                    fill = 'green';
                }
            }

            if (!text) {
                text = 'Unknown';
            }
            node.status({ fill: fill, shape: shape, text: text });
        }

        //
        //
        //
        //
        updateState(new_states, current_state, state_types, exclusive_states) {
            const node = this;
            let modified = [];
            Object.keys(state_types).forEach(key => {
                if (new_states.hasOwnProperty(key)) {
                    // console.log("CCHI found key " + key);
                    // TODO DEEP_STATES
                    let o_modified = node.setState(key, new_states[key], current_state, state_types[key], exclusive_states[key] || {});
                    if (o_modified) {
                        node._debug('updateState set "' + key + '" to ' + JSON.stringify(new_states[key]));
                        modified.push(o_modified);
                    }
                    // console.log("CCHI set " + key + " val " + JSON.stringify(current_state[key]));
                }
            });
            node._debug('updateState new state modified ' + JSON.stringify(modified) + ' state ' + JSON.stringify(current_state));
            return modified;
        }

        //
        //
        //
        //
        cloneObject(cur_obj, new_obj, state_values, exclusive_states) {
            const node = this;
            let differs = false;
            if (exclusive_states === undefined) {
                exclusive_states = {};
            }
            Object.keys(state_values).forEach(function (key) {
                if (typeof new_obj[key] !== 'undefined' && new_obj[key] != null) {
                    if (node.setState(key, new_obj[key], cur_obj, state_values[key] || {}, exclusive_states[key] || {})) {
                        differs = true;
                    }
                } else if (!(state_values[key].type & Formats.MANDATORY)) {
                    delete cur_obj[key];
                }
            });
            return differs;
        }

        //
        //
        //
        //
        formatValue(key, value, format, default_value) {
            if (typeof value === 'undefined') {
                value = default_value;
            }

            if (typeof value === 'string') {
                switch (format) {
                    case Formats.BOOL:
                        let t = value.toUpperCase()

                        if (t == "TRUE" || t == "ON" || t == "YES" || t == "1") {
                            return true;
                        } else if (t == "FALSE" || t == "OFF" || t == "NO" || t == "0") {
                            return false;
                        } else {
                            throw new Error('Type of ' + key + ' is string but it cannot be converted to a boolean');
                        }

                    case Formats.STRING:
                        return value;

                    case Formats.FLOAT:
                        let fval = parseFloat(value);

                        if (isNaN(fval)) {
                            throw new Error('Type of ' + key + ' is string but it cannot be converted to a float');
                        }

                        return fval;

                    case Formats.DATETIME:
                        return value;

                    default:
                        let val = parseInt(value)

                        if (isNaN(val)) {
                            throw new Error('Type of ' + key + ' is string but it cannot be converted to a integer');
                        }

                        return val;
                }
            } else if (typeof value === 'number') {
                switch (format) {
                    case Formats.BOOL:
                        let val = (value != 0)
                        return val;

                    case Formats.STRING:
                        return value.toString();

                    case Formats.DATETIME:
                        let dval = new Date(value);
                        return dval.toISOString();

                    default:
                        return value;
                }
            } else if (typeof value === 'boolean') {
                switch (format) {
                    case Formats.BOOL:
                        return value;

                    case Formats.STRING:
                        if (value) {
                            return "true";
                        } else {
                            return "false";
                        }

                    default:
                        if (value) {
                            return 1;
                        } else {
                            return 0;
                        }
                }
            } else if (typeof value === 'object') {
                if (value.hasOwnProperty(key)) {
                    return FormatValue(format, key, value[key]);
                } else {
                    throw new Error('Type of ' + key + ' is object but it does not have matching property');
                }
            } else {
                throw new Error('Type of ' + key + ' is not compatible; typeof = ' + typeof value + "; value = " + JSON.stringify(value));
            }
        }

        //
        //
        //
        //
        setState(key, value, state, state_type, exclusive_states) {
            const node = this;
            let differs = false;
            let old_state = typeof state === 'object' ? state[key] : {};
            let new_state = undefined;
            if (typeof state_type === 'number') {
                state_type = {
                    type: state_type
                };
            }
            exclusive_states = state_type.exclusive_states || {};
            let exclusive_states_arr = [];
            if (Array.isArray(exclusive_states)) {
                exclusive_states_arr = exclusive_states;
                exclusive_states = {};
            }
            // console.log("CCHI ---> setState key " + JSON.stringify(key) + " v " + JSON.stringify(value) + " ov " + JSON.stringify(old_state) + " st " + JSON.stringify(state_type) + " ex " + JSON.stringify(exclusive_states));

            if (value == null) {
                if (state_type.type & Formats.MANDATORY) {
                    RED.log.error("key " + key + " is mandatory.");
                } else if (state.hasOwnProperty(key)) {
                    delete state[key];
                    differs = key;
                }
            } else if (state_type.type & Formats.ARRAY) {
                if (!Array.isArray(value)) {
                    value = [value];
                }
                // checks array
                if (!(state_type.type & Formats.OBJECT)) {
                    let new_arr = [];
                    let old_arr = Array.isArray(old_state) ? old_state : [];
                    const allowed_values = ar_statstate_typee_values.values;
                    value.forEach((elm, idx) => {
                        let new_val = node.formatValue(key + '[' + idx + ']', elm, state_type.type & Formats.PRIMITIVE);
                        if (state_type.upper_case && new_val) {
                            new_val = new_val.toUpperCase();
                        }
                        if (new_val !== undefined && new_val !== null && (allowed_values === undefined || allowed_values.includes(new_val))) {
                            new_arr.push(new_val);
                            if (old_arr.length > idx) {
                                if (old_arr[idx] != new_val) {
                                    differs = key;
                                }
                            } else {
                                differs = key;
                            }
                        } else {
                            differs = key;
                        }
                    });
                    state[key] = new_arr;
                } else {
                    // structure check
                    let new_arr = [];
                    let old_arr = Array.isArray(old_state) ? old_state : [];
                    let key_id = state_type.key_id || undefined;
                    let add_if_missing = typeof state_type.add_if_missing === 'boolean' ? state_type.add_if_missing : true;
                    let remove_if_no_data = !(state_type.type & Formats.MANDATORY);
                    let is_valid_key;
                    let replace_all = state_type.replace_all || key_id === undefined;
                    if (typeof state_type.is_valid_key === 'function') {
                        is_valid_key = state_type.is_valid_key;
                    } else {
                        is_valid_key = key => true;
                    }
                    value.forEach((new_obj, idx) => {
                        let cur_obj;
                        if (key_id) {
                            let f_arr;
                            if (typeof key_id === 'string') {
                                f_arr = old_arr.filter(obj => { return obj[key_id] === new_obj[key_id] });
                            } else {
                                f_arr = old_arr.filter(obj => {
                                    let obj_equal = true;
                                    key_id.forEach(key_idi => {
                                        if (obj[key_idi] !== new_obj[key_idi]) {
                                            obj_equal = false;
                                        }
                                    });
                                    return obj_equal;
                                });
                            }
                            if (f_arr.length > 1) {
                                RED.log.error('More than one "' + key + '" for "' + key_id + '" "' + new_obj[key_id] + '"');
                            } else if (f_arr.length > 0) {
                                cur_obj = f_arr[0];
                            } else if (add_if_missing) {
                                let key_id0 = typeof key_id === 'string' ? key_id : key_id[0];
                                let key1 = is_valid_key(new_obj[key_id0]);
                                if (key1) {
                                    cur_obj = {};
                                    if (typeof key1 === 'string') {
                                        new_obj[key_id0] = key1;
                                    }
                                    old_arr.push(cur_obj);
                                }
                            }
                        } else {
                            cur_obj = old_arr[idx];
                            if (cur_obj === undefined && add_if_missing) {
                                cur_obj = {};
                            }
                        }
                        if (cur_obj !== undefined) {
                            if (node.cloneObject(cur_obj, new_obj, state_type.attributes, exclusive_states)) {
                                differs = key;
                            }
                            if (Object.keys(cur_obj).length > 0) {
                                new_arr.push(cur_obj);
                            } else {
                                differs = key; // ??
                            }
                        }
                    });
                    if (replace_all && new_arr.length != old_arr.length) {
                        differs = key;
                    }
                    state[key] = replace_all ? new_arr : old_arr;
                    if (remove_if_no_data && state[key].length === 0) {
                        delete state[key];
                    }
                }
            } else if (state_type.type & Formats.OBJECT) {
                if (Array.isArray(value)) {
                    RED.log.error('key "' + key + '" must be an object.');
                } else {
                    if (state[key] === undefined) {
                        state[key] = {};
                        old_state = state[key];
                    }
                    let mandatory_to_delete = [];
                    let o_differs = [];
                    Object.keys(state_type.attributes).forEach(function (ikey) {
                        // console.log("---> Attributes key " + ikey + " " + JSON.stringify(value[ikey]));
                        if (typeof value[ikey] !== 'undefined' && value[ikey] != null) {
                            if (typeof old_state[ikey] == 'undefined') {
                                old_state[ikey] = {};
                            }
                            if (node.setState(ikey, value[ikey], old_state, state_type.attributes[ikey], exclusive_states[ikey] || {})) {
                                o_differs.push(ikey);
                                differs = o_differs;
                            }
                        } else {
                            const a_state_type = typeof state_type.attributes[ikey] === 'number' ? state_type.attributes[ikey] : state_type.attributes[ikey].type;
                            // console.log("a_state " + JSON.stringify(a_state_type));
                            if (a_state_type & Formats.MANDATORY) {
                                mandatory_to_delete.push(ikey);
                            } else {
                                if (typeof state[ikey] != 'undefined') {
                                    o_differs.push(ikey);
                                    differs = o_differs;
                                }
                                delete state[key][ikey];
                                // console.log("Deleted " + ikey + " " + JSON.stringify(state[key]));
                            }
                        }
                    });
                    mandatory_to_delete.forEach(ikey => {
                        // console.log("try removing " + ikey);
                        const e_states = exclusive_states[ikey] || [];
                        let exclusive_state_found = false;
                        e_states.forEach(e_state => {
                            if (typeof state[e_state] !== 'undefined') {
                                exclusive_state_found = false;
                            }
                        });
                        if (!exclusive_state_found) {
                            if (typeof state[ikey] != 'undefined') {
                                o_differs.push(ikey);
                                differs = o_differs;
                            }
                            delete state[ikey];
                        } else {
                            RED.log.error('key "' + key + '.' + ikey + '" is mandatory.');
                        }
                    });
                }
            } else if (state_type.type & Formats.COPY_OBJECT) {
                if (typeof value !== 'object' || Array.isArray(value)) {
                    RED.log.error('key "' + key + '" must be an object.');
                } else {
                    Object.keys(old_state).forEach(function (ikey) {
                        if (typeof value[ikey] !== 'undefined') {
                            if (node.setState(ikey, value[ikey], old_state, state_type.type - Formats.COPY_OBJECT, {})) {
                                differs = key;
                            }
                        }
                    });
                }
            } else {
                new_state = node.formatValue(key, value, state_type.type & Formats.PRIMITIVE, state_type.default_value);
                // console.log("CCHI checking new_state " + key + " " + new_state + " type " + JSON.stringify(state_type));
                if (state_type.min !== undefined && new_state < state_type.min) {
                    RED.log.error('key "' + key + '" must be greather or equal than ' + state_type.min);
                    new_state = undefined;
                } else if (state_type.max !== undefined && new_state > state_type.max) {
                    RED.log.error('key "' + key + '" must be lower or equal than ' + state_type.max);
                    new_state = undefined;
                } else if (Array.isArray(state_type.values) && !state_type.values.includes(new_state)) {
                    RED.log.error('key "' + key + '" must be one of ' + JSON.stringify(state_type.values));
                    new_state = undefined;
                }
            }
            if (new_state !== undefined && !(state_type.type & (Formats.OBJECT | Formats.ARRAY))) {
                // console.log("CCHI Update state for " + key + " to " + new_state);
                if (old_state !== new_state) {
                    differs = key;
                }
                state[key] = new_state;
            }
            if (differs) {
                exclusive_states_arr.forEach(rkey => delete state[rkey]);
            }
            // console.log("CCHI END ----> " + key + " = " + JSON.stringify(state[key]));
            if (Array.isArray(differs)) {
                let o_differs = {};
                o_differs[key] = differs;
                return o_differs;
            }
            return differs;
        }

        //
        //
        //
        //
        setValues(from_object, to_object) {
            const node = this;
            return node.updateState(from_object, node.state, node.state_types, EXCLUSIVE_STATES);
        }

        //
        //
        //
        //
        to_int(value, default_value) {
            const n = parseInt(value);
            const f = parseFloat(value);
            if (!isNaN(value) && Number.isInteger(f)) {
                return n;
            }
            return default_value;
        }
        //
        //
        //
        //
        to_float(value, default_value) {
            if (isNaN(value)) {
                return default_value;
            }
            return parseFloat(value);
        }
    }
    RED.nodes.registerType("alexa-device", AlexaDeviceNode);
}
