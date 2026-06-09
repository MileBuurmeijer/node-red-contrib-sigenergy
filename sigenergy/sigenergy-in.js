module.exports = function(RED) {
    "use strict";

    function parseTopic(topic, baseTopic) {
        // Expected format: baseTopic/entityId/suffix
        // e.g. sigenergy2mqtt/sigen_0_inverter_1_battery_soc/state
        const parts = topic.split('/');
        if (parts.length >= 2 && parts[0] === baseTopic) {
            const entityId = parts[1];
            const suffix = parts[2] || 'state';
            
            // Extract inverter/device ID (e.g., sigen_0_inverter_1)
            const match = entityId.match(/^(sigen_\d+_[a-zA-Z0-9]+_\d+)/);
            const inverterId = match ? match[1] : 'sigen_unknown';
            
            // Extract sensor/capability name
            let sensorName = entityId;
            if (entityId.startsWith(inverterId + '_')) {
                sensorName = entityId.substring(inverterId.length + 1);
            }
            
            return {
                inverterId,
                entityId,
                sensorName,
                suffix
            };
        }
        return null;
    }

    function categorizeSensor(sensorName) {
        const name = sensorName.toLowerCase();
        
        // EV Charger
        if (name.includes('ev') || name.includes('charger') || name.includes('car')) {
            return 'ev';
        }
        // Solar / PV Production
        if (name.includes('solar') || name.includes('pv') || name.includes('mppt') || name.includes('yield') || name.includes('pv_power')) {
            return 'solar';
        }
        // Grid Status/Power
        if (name.includes('grid') || name.includes('export') || name.includes('import') || name.includes('feedin') || name.includes('meter')) {
            return 'grid';
        }
        // Battery Charging/Discharging/SoC
        if (name.includes('battery') || name.includes('ess') || name.includes('soc') || name.includes('soh') || name.includes('charge') || name.includes('discharge') || name.includes('bms')) {
            return 'battery';
        }
        // Other (load, temperature, system status, etc.)
        return 'other';
    }

    function SigenergyInNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Config properties
        node.broker = config.broker;
        node.baseTopic = config.baseTopic || 'sigenergy2mqtt';
        node.inverterId = config.inverterId || 'all';
        node.outputMode = config.outputMode || 'split'; // 'split' or 'grouped'
        
        // Capabilities filters
        node.filterSensors = config.filterSensors;
        node.catBattery = config.catBattery !== false;
        node.catSolar = config.catSolar !== false;
        node.catGrid = config.catGrid !== false;
        node.catEV = config.catEV !== false;
        node.catOther = config.catOther !== false;

        // Retrieve the MQTT broker configuration node
        node.brokerConfig = RED.nodes.getNode(node.broker);

        // State cache for grouped output mode
        node.stateCache = {};
        node.debounceTimers = {};

        if (node.brokerConfig) {
            // Register with the broker to handle connection status reporting
            node.brokerConfig.register(node);
            
            // Subscribe to all sigenergy2mqtt topics
            const wildcardTopic = node.baseTopic + '/#';
            const qos = 0;

            node.brokerConfig.subscribe(wildcardTopic, qos, function(topic, payload, packet) {
                // Parse the MQTT payload
                let value = payload.toString();
                // Attempt to parse JSON or numbers
                try {
                    if (value === 'true') value = true;
                    else if (value === 'false') value = false;
                    else if (!isNaN(value) && value.trim() !== '') {
                        value = Number(value);
                    } else {
                        value = JSON.parse(value);
                    }
                } catch(e) {
                    // Stay as string
                }

                const parsed = parseTopic(topic, node.baseTopic);
                if (!parsed) return;

                const { inverterId, sensorName, suffix } = parsed;

                // 1. Filter by Inverter ID
                if (node.inverterId !== 'all' && node.inverterId !== inverterId) {
                    return;
                }

                // 2. Filter by Category
                const category = categorizeSensor(sensorName);
                if (node.filterSensors) {
                    if (category === 'battery' && !node.catBattery) return;
                    if (category === 'solar' && !node.catSolar) return;
                    if (category === 'grid' && !node.catGrid) return;
                    if (category === 'ev' && !node.catEV) return;
                    if (category === 'other' && !node.catOther) return;
                }

                if (node.outputMode === 'split') {
                    // Output individual state changes immediately
                    const msg = {
                        topic: topic,
                        payload: value,
                        sensor: sensorName,
                        inverterId: inverterId,
                        category: category,
                        suffix: suffix
                    };
                    node.send(msg);
                } else if (node.outputMode === 'grouped') {
                    // Update state cache
                    if (!node.stateCache[inverterId]) {
                        node.stateCache[inverterId] = {};
                    }
                    node.stateCache[inverterId][sensorName] = value;

                    // Debounce output to aggregate rapidly arriving updates
                    if (node.debounceTimers[inverterId]) {
                        clearTimeout(node.debounceTimers[inverterId]);
                    }

                    node.debounceTimers[inverterId] = setTimeout(function() {
                        const msg = {
                            topic: node.baseTopic + '/' + inverterId,
                            payload: Object.assign({}, node.stateCache[inverterId]),
                            inverterId: inverterId
                        };
                        node.send(msg);
                        delete node.debounceTimers[inverterId];
                    }, 250); // 250ms aggregation window
                }
            }, node.id);

            // Handle connection status manually as a fallback
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
            // Clear any pending debouncers
            for (const id in node.debounceTimers) {
                clearTimeout(node.debounceTimers[id]);
            }
            if (node.brokerConfig) {
                const wildcardTopic = node.baseTopic + '/#';
                node.brokerConfig.unsubscribe(wildcardTopic, node.id);
                node.brokerConfig.deregister(node, done);
            } else {
                done();
            }
        });
    }

    RED.nodes.registerType("sigenergy-in", SigenergyInNode);

    // Admin endpoint for inverter auto-discovery
    RED.httpAdmin.get('/sigenergy/discover/:brokerId', RED.auth.needsPermission('read'), function(req, res) {
        const brokerId = req.params.brokerId;
        const brokerNode = RED.nodes.getNode(brokerId);
        
        if (!brokerNode) {
            return res.json({ error: "Broker config node not found. Please deploy it first." });
        }

        const baseTopic = req.query.baseTopic || 'sigenergy2mqtt';
        const wildcardTopic = baseTopic + '/#';
        const discovered = new Set();
        const tempRef = "discover_" + Math.random().toString(36).substring(2);

        try {
            brokerNode.subscribe(wildcardTopic, 0, function(topic, payload, packet) {
                const parts = topic.split('/');
                if (parts.length >= 2 && parts[0] === baseTopic) {
                    const entityId = parts[1];
                    const match = entityId.match(/^(sigen_\d+_[a-zA-Z0-9]+_\d+)/);
                    if (match) {
                        discovered.add(match[1]);
                    }
                }
            }, tempRef);
        } catch(e) {
            return res.json({ error: "Failed to connect to broker. Error: " + e.message });
        }

        // Scan for 1.5 seconds, then return unique discovered inverter prefixes
        setTimeout(() => {
            try {
                brokerNode.unsubscribe(wildcardTopic, tempRef);
            } catch(e) {
                // Ignore unsubscribe errors
            }
            res.json({ inverters: Array.from(discovered) });
        }, 1500);
    });
};
