module.exports = function(RED) {
    "use strict";

    function SigenergyOutNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Config properties
        node.broker = config.broker;
        node.baseTopic = config.baseTopic || 'sigenergy2mqtt';
        node.inverterId = config.inverterId;
        node.commandType = config.commandType || 'ess_charge_cut_off_soc';
        node.customCommand = config.customCommand || '';
        node.payloadSource = config.payloadSource || 'payload'; // 'payload' or 'fixed'
        node.fixedValue = config.fixedValue || '';

        // Retrieve the MQTT broker configuration node
        node.brokerConfig = RED.nodes.getNode(node.broker);

        if (node.brokerConfig) {
            // Register with the broker to handle connection status reporting
            node.brokerConfig.register(node);

            // Handle incoming messages
            node.on('input', function(msg, send, done) {
                // 1. Determine the inverter ID (allow dynamic override from msg.inverterId)
                const inverterId = msg.inverterId || node.inverterId;
                if (!inverterId) {
                    node.error("No Inverter ID specified. Set it in node properties or pass msg.inverterId.");
                    node.status({fill:"red",shape:"ring",text:"missing inverter id"});
                    if (done) done();
                    return;
                }

                // 2. Determine the sensor/setting name (allow dynamic override from msg.sensor or msg.command)
                let sensorName = node.commandType;
                if (sensorName === 'custom') {
                    sensorName = node.customCommand;
                }
                // Allow dynamic override
                sensorName = msg.sensor || msg.command || sensorName;

                if (!sensorName) {
                    node.error("No command or sensor name specified. Set it in node properties or pass msg.sensor.");
                    node.status({fill:"red",shape:"ring",text:"missing sensor name"});
                    if (done) done();
                    return;
                }

                // 3. Determine the value to write
                let value = node.fixedValue;
                if (node.payloadSource === 'payload') {
                    value = msg.payload;
                }

                if (value === undefined || value === null) {
                    node.warn("Payload value is undefined or null. Skip publishing.");
                    if (done) done();
                    return;
                }

                // 4. Construct the topic: baseTopic/inverterId_sensorName/set
                const topic = `${node.baseTopic}/${inverterId}_${sensorName}/set`;
                
                // Convert value to string format for MQTT payload
                let payloadStr;
                if (typeof value === 'object') {
                    payloadStr = JSON.stringify(value);
                } else {
                    payloadStr = String(value);
                }

                // 5. Publish to MQTT Broker
                if (node.brokerConfig.client && node.brokerConfig.client.connected) {
                    const publishOptions = { qos: 0, retain: false };
                    
                    node.brokerConfig.client.publish(topic, payloadStr, publishOptions, function(err) {
                        if (err) {
                            node.error("Failed to publish to MQTT: " + err.toString());
                            node.status({fill:"red",shape:"dot",text:"publish failed"});
                        } else {
                            node.status({fill:"green",shape:"dot",text:"sent: " + payloadStr});
                            
                            // Revert status back to connected after 2s
                            setTimeout(() => {
                                if (node.brokerConfig.connected) {
                                    node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
                                }
                            }, 2000);
                        }
                        if (done) done();
                    });
                } else {
                    node.error("MQTT Broker is offline. Cannot send command.");
                    node.status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
                    if (done) done();
                }
            });

            // Set initial status based on broker state
            if (node.brokerConfig.connected) {
                node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
            } else {
                node.status({fill:"red",shape:"ring",text:"node-red:common.status.disconnected"});
            }
        } else {
            node.error(RED._("mqtt.errors.missing-config"));
        }

        // Cleanup on node close
        node.on('close', function(removed, done) {
            if (node.brokerConfig) {
                node.brokerConfig.deregister(node, done);
            } else {
                done();
            }
        });
    }

    RED.nodes.registerType("sigenergy-out", SigenergyOutNode);
};
