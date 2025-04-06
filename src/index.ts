import ModbusRTU from "modbus-serial";
import { Buffer } from "buffer";
import { DeviceConfig, ModbusDataType } from "./types/modbus";
import * as iot from "aws-iot-device-sdk";
import path from "path";
import fs from "fs";

// ====================
// Device & Component Configuration
// ====================

const devices: DeviceConfig[] = [
  {
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
      { address: 53, desc: "power_factor_phase_b", type: "input", data_type: "float", multiplier: 1 }
    ]
  },
  {
    name: "BESS",
    ip: "192.168.1.253",
    port: 502,
    unit_id: 1,
    registers: [
      { address: 51, desc: "dc_voltage", type: "input", data_type: "float", multiplier: 1 },
      { address: 53, desc: "dc_current", type: "input", data_type: "float", multiplier: 1 },
      { address: 55, desc: "state_of_charge", type: "input", data_type: "float", multiplier: 1 },
      { address: 57, desc: "state_of_health", type: "input", data_type: "float", multiplier: 1 },
      { address: 73, desc: "max_cell_voltage", type: "input", data_type: "float", multiplier: 1 },
      { address: 75, desc: "min_cell_voltage", type: "input", data_type: "float", multiplier: 1 },
      { address: 79, desc: "max_cell_temp", type: "input", data_type: "float", multiplier: 1 },
      { address: 81, desc: "min_cell_temp", type: "input", data_type: "float", multiplier: 1 }
    ]
  }
];

const componentMap: Record<string, { key: string; name: string }> = {
  "BESS": { key: "bess", name: "Battery" },
  "BESS-AC": { key: "bess_ac", name: "BESS AC" }
};

// ====================
// AWS IoT Setup
// ====================

const iotDevice = new iot.device({
  keyPath: path.resolve(__dirname, "./assets/SULA_site.private.key"),
  certPath: path.resolve(__dirname, "./assets/SULA_site.cert.pem"),
  caPath: path.resolve(__dirname, "./assets/root-CA.crt"),
  clientId: "basicPubSub",
  host: "a2elcji7bmbmdl-ats.iot.ap-south-1.amazonaws.com",
  protocol: "mqtts",
  port: 8883,
  reconnectPeriod: 5000,
});

// Global connection flag
let isConnected = false;

// ====================
// Constants
// ====================

const POLL_INTERVAL = 10_000; // 10 seconds
const REGISTER_READ_DELAY = 300; // 300 ms delay between register reads
const OFFLINE_DATA_FILE = path.resolve(__dirname, "./offline_data.json");

// ====================
// Helper Functions
// ====================

// Simple delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Determine register count based on data type (e.g., float needs 2 registers)
function getRegisterCount(dataType: ModbusDataType): number {
  return dataType === "float" ? 2 : 1;
}

// Process register data using type and multiplier
function processRegisterData(data: number[], reg: DeviceConfig["registers"][0]): number | null {
  try {
    let value: number;
    if (reg.data_type === "float") {
      // Create a 4-byte buffer from the two 16-bit registers
      const buffer = Buffer.alloc(4);
      // Write data using little-endian (adjust if needed)
      buffer.writeUInt16LE(data[0], 0);
      buffer.writeUInt16LE(data[1], 2);
      value = buffer.readFloatLE(0);
    } else if (reg.data_type === "int16") {
      // For int16, assume single register value
      value = data[0];
      // Simple two's complement handling (for demonstration)
      if (value > 32767) value = value - 65536;
    } else {
      throw new Error(`Unsupported data type: ${reg.data_type}`);
    }
    return parseFloat((value * reg.multiplier).toFixed(2));
  } catch (error) {
    console.error(`Data processing error for ${reg.desc}:`, error);
    return null;
  }
}

// ====================
// Modbus Polling & Payload Creation
// ====================

async function pollDevice(device: DeviceConfig): Promise<any> {
  const modbusClient = new ModbusRTU();
  const metrics: Record<string, number | null> = {};

  try {
    console.log(`Connecting to ${device.name} at ${device.ip}:${device.port}...`);
    await modbusClient.connectTCP(device.ip, { port: device.port });
    modbusClient.setID(device.unit_id);

    for (const reg of device.registers) {
      // Validate address
      if (reg.address < 1 || reg.address > 65535) {
        console.error(`Invalid address ${reg.address} for ${reg.desc}`);
        metrics[reg.desc] = null;
        continue;
      }

      try {
        // Choose read method based on register type
        const registerCount = getRegisterCount(reg.data_type);
        const raw = reg.type === "input"
          ? await modbusClient.readInputRegisters(reg.address - 1, registerCount)
          : await modbusClient.readHoldingRegisters(reg.address - 1, registerCount);

        if (!raw?.data || raw.data.length < registerCount) {
          metrics[reg.desc] = null;
          continue;
        }

        metrics[reg.desc] = processRegisterData(raw.data, reg);
      } catch (err) {
        console.error(`Read error for ${reg.desc} on ${device.name}:`, err);
        metrics[reg.desc] = null;
      }

      await delay(REGISTER_READ_DELAY);
    }
  } catch (error) {
    console.error(`Error polling ${device.name}:`, error);
    return null;
  } finally {
    try {
      await modbusClient.close();
    } catch (error) {
      console.error(`Error closing connection for ${device.name}:`, error);
    }
  }

  const map = componentMap[device.name] || { key: device.name.toLowerCase(), name: device.name };
  return { key: map.key, name: map.name, metrics };
}

async function createPayload() {
  const payloadTimestamp = new Date().toISOString();
  const components: Record<string, any> = {};

  for (const device of devices) {
    const data = await pollDevice(device);
    if (data) {
      components[data.key] = { name: data.name, metrics: data.metrics };
    }
  }

  const payload = {
    timestamp: payloadTimestamp,
    site_id: 3,
    components
  };

  console.log("✅ Payload created:", JSON.stringify(payload, null, 2));
  return payload;
}

// ====================
// AWS IoT Publishing
// ====================

function publishToIoT(payload: any): Promise<boolean> {
  return new Promise((resolve) => {
    const topic = "sula_parameters"; // Change topic if needed
    const message = JSON.stringify(payload);

    iotDevice.publish(topic, message, {}, (err) => {
      if (err) {
        console.error("❌ Failed to publish to AWS IoT:", err);
        return resolve(false);
      }
      console.log("📡 Payload published to AWS IoT successfully.");
      resolve(true);
    });
  });
}

// Retry sending offline data from file
async function retryOfflineData() {
  if (!fs.existsSync(OFFLINE_DATA_FILE)) return;
  try {
    const offlineData = JSON.parse(fs.readFileSync(OFFLINE_DATA_FILE, "utf8"));
    const successful: any[] = [];
    
    for (const payload of offlineData) {
      if (await publishToIoT(payload)) {
        successful.push(payload);
      }
    }
    
    const remaining = offlineData.filter((p: any) => !successful.includes(p));
    fs.writeFileSync(OFFLINE_DATA_FILE, JSON.stringify(remaining, null, 2));
    if (remaining.length === 0) {
      console.log("✅ All offline payloads published; offline storage cleared.");
    }
  } catch (e) {
    console.error("Offline data retry failed:", e);
  }
}

// Save payload locally if IoT publish fails
function savePayloadOffline(payload: any) {
  let existingData: any[] = [];
  if (fs.existsSync(OFFLINE_DATA_FILE)) {
    const raw = fs.readFileSync(OFFLINE_DATA_FILE, "utf8");
    try {
      existingData = JSON.parse(raw);
    } catch (e) {
      console.error("⚠️ Failed to parse offline data file, starting fresh.");
    }
  }
  existingData.push(payload);
  fs.writeFileSync(OFFLINE_DATA_FILE, JSON.stringify(existingData, null, 2));
  console.log("💾 Payload saved locally due to IoT disconnect.");
}

// ====================
// Polling Controller
// ====================

function startPolling() {
  setInterval(async () => {
    try {
      const payload = await createPayload();
      if (isConnected) {
        const published = await publishToIoT(payload);
        if (!published) {
          savePayloadOffline(payload);
        }
      } else {
        console.warn("⚠️ Not connected to AWS IoT, saving payload offline.");
        savePayloadOffline(payload);
      }
    } catch (e) {
      console.error("Polling cycle error:", e);
    }
  }, POLL_INTERVAL);
}

// ====================
// AWS IoT Event Handlers
// ====================

iotDevice
  .on("connect", () => {
    console.log("🔌 Connected to AWS IoT.");
    isConnected = true;
    retryOfflineData();
  })
  .on("close", () => {
    console.warn("🔌 Disconnected from AWS IoT.");
    isConnected = false;
  });

// ====================
// Application Initialization
// ====================

function main() {
  console.log("⏳ Data polling started.");
  startPolling();

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down gracefully...");
    iotDevice.end();
    process.exit();
  });
}

main();