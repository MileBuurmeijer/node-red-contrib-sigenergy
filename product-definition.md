# Product Definition

## Summary

**Product Description**

- **Business need** - Enable users to monitor and control their Sigenergy inverters in Node-Red.

**Capabilities**

- Monitor inverter status
- Control inverter settings
- Control battery charging and discharging
- Control EV charging
- Monitor grid status
- Monitor solar production
- Monitor energy consumption
- Set up automation rules

## Details

### Technical Details
- It is a front end for the Sigenergy2Mqtt service that interfaces between the sigenergy installation and the local MQTT broker. See here: https://github.com/seud0nym/sigenergy2mqtt
- It should use the normal Mqtt configuration node.
- It should have in and out nodes. The out node should be able to send commands to the inverter via the Sigenergy2Mqtt service. 
- It should discover the inverter based on the all the topics under the base topic 'sigenergy2mqtt'. For example sigenergy2mqtt/sigen_0_inverter_1_battery_soc/state to retrieve the battery state of charge (SoC).


