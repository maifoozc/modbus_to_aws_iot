import ModbusRTU from "modbus-serial";
import { Buffer } from "buffer";
import { DeviceConfig } from "./types/modbus";
import * as iot from "aws-iot-device-sdk";
import * as path from "path";

const bessAcConfig: DeviceConfig = {
  name: "BESS-AC",
  ip: "192.168.1.202",
  port: 2,
  unit_id: 1,
  registers: [
    { address: 1, desc: "voltage_phase_r", type: "input", data_type: "float", multiplier: 1 },
    { address: 3, desc: "voltage_phase_y", type: "input", data_type: "float", multiplier: 1 },
    { address: 5, desc: "voltage_phase_b", type: "input", data_type: "float", multiplier: 1 },
    { address: 9, desc: "voltage_ry", type: "input", data_type: "float", multiplier: 1 },
    { address: 11, desc: "voltage_yb", type: "input", data_type: "float", multiplier: 1 },
    { address: 13, desc: "voltage_br", type: "input", data_type: "float", multiplier: 1 },
    { address: 17, desc: "current_phase_r", type: "input", data_type: "float", multiplier: 1 },
    { address: 19, desc: "current_phase_y", type: "input", data_type: "float", multiplier: 1 },
    { address: 21, desc: "current_phase_b", type: "input", data_type: "float", multiplier: 1 },
    { address: 49, desc: "power_factor_phase_r", type: "input", data_type: "float", multiplier: 1 },
    { address: 51, desc: "power_factor_phase_y", type: "input", data_type: "float", multiplier: 1 },
    { address: 53, desc: "power_factor_phase_b", type: "input", data_type: "float", multiplier: 1 },
  ],
};

const iotDevice = new iot.device({
  keyPath: path.resolve(__dirname, "./assets/SULA_site.private.key"),
  certPath: path.resolve(__dirname, "./assets/SULA_site.cert.pem"),
  caPath: path.resolve(__dirname, "./assets/root-CA.crt"),
  clientId: `basicPubSub`,
  host: "a2elcji7bmbmdl-ats.iot.ap-south-1.amazonaws.com",
  protocol: "mqtts",
  port: 8883,
  reconnectPeriod: 5000,
});

const modbusClient = new ModbusRTU();
let isModbusConnected = false;

async function initializeConnections() {
  iotDevice
    .on("connect", async () => {
      console.log("✅ Connected to AWS IoT");
      await initializeModbusConnection();
      startPolling();
    })
    .on("error", (err) => console.error("AWS IoT Error:", err))
    .on("offline", () => console.log("AWS IoT Offline"));
}

async function initializeModbusConnection() {
  if (!isModbusConnected) {
    console.log(`Connecting to ${bessAcConfig.name} at ${bessAcConfig.ip}:${bessAcConfig.port}...`);
    await modbusClient.connectTCP(bessAcConfig.ip, { port: bessAcConfig.port });
    modbusClient.setID(bessAcConfig.unit_id);
    isModbusConnected = true;
    console.log("Modbus connection established and will be reused!");
  }
}

function startPolling() {
  collectAndPublishData();

  setInterval(() => {
    if (isModbusConnected) {
      collectAndPublishData();
    } else {
      console.log("Skipping poll - Modbus disconnected");
      initializeModbusConnection();
    }
  }, 10000);
}

async function collectAndPublishData() {
  const timestamp = new Date().toISOString();
  const readings: Record<string, number | null> = {};

  try {
    if (!isModbusConnected) {
      await initializeModbusConnection();
    }

    for (const register of bessAcConfig.registers) {
      try {
        const rawValues = await modbusClient.readInputRegisters(register.address - 1, 2);

        if (rawValues?.data?.length >= 2) {
          const buffer = Buffer.alloc(4);
          buffer.writeUInt16LE(rawValues.data[0], 0);
          buffer.writeUInt16LE(rawValues.data[1], 2);
          const voltage = buffer.readFloatLE(0) * register.multiplier;
          readings[register.desc] = parseFloat(voltage.toFixed(2));
        } else {
          readings[register.desc] = null;
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`❌ Error reading ${register.desc}:`, error);
        readings[register.desc] = null;
        isModbusConnected = false;
      }
    }

    // Prepare and publish payload
    const payload = {
      device: bessAcConfig.name,
      timestamp,
      readings,
      status: Object.values(readings).every(val => val !== null) ? "healthy" : "partial", new: "new"
    };

    iotDevice.publish("sula_parameters", JSON.stringify(payload), { qos: 1 });
    console.log("payload is published: ", payload)
  } catch (error) {
    console.error("❌ Data collection failed:", error);
    isModbusConnected = false;
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  if (isModbusConnected) {
    await modbusClient.close();
  }
  iotDevice.end();
  process.exit(0);
});

// Start the application
initializeConnections();