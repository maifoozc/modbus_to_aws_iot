import ModbusRTU from "modbus-serial";
import { Buffer } from "buffer";
import { DeviceConfig, ModbusDataType } from "./types/modbus";
import * as iot from "aws-iot-device-sdk";
import path from "path";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";

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
      {
        address: 1,
        desc: "voltage_phase_r",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 3,
        desc: "voltage_phase_y",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 5,
        desc: "voltage_phase_b",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 9,
        desc: "voltage_ry",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 11,
        desc: "voltage_yb",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 13,
        desc: "voltage_br",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 17,
        desc: "current_phase_r",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 19,
        desc: "current_phase_y",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 21,
        desc: "current_phase_b",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 49,
        desc: "power_factor_phase_r",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 51,
        desc: "power_factor_phase_y",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 53,
        desc: "power_factor_phase_b",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 59,
        desc: "total_import",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 75,
        desc: "total_export",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
    ],
  },
  {
    name: "BESS-AUX",
    ip: "192.168.1.203",
    port: 3,
    unit_id: 1,
    registers: [
      {
        address: 88,
        desc: "auxillary_power",
        type: "input",
        data_type: "float",
        multiplier: 1
      }
    ]
  },
  {
    name: "BESS",
    ip: "192.168.1.253",
    port: 502,
    unit_id: 1,
    registers: [
      {
        address: 51,
        desc: "dc_voltage",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 53,
        desc: "dc_current",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 55,
        desc: "state_of_charge",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 57,
        desc: "state_of_health",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 73,
        desc: "max_cell_voltage",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 75,
        desc: "min_cell_voltage",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 79,
        desc: "max_cell_temp",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
      {
        address: 81,
        desc: "min_cell_temp",
        type: "input",
        data_type: "float",
        multiplier: 1,
      },
    ],
  },
];

const componentMap: Record<string, { key: string; name: string }> = {
  BESS: { key: "bess", name: "Battery" },
  "BESS-AC": { key: "bess_ac", name: "BESS AC" },
  "BESS-AUX": { key: "bess_ac", name: "BESS AC" },
};

// ====================
// Database Setup
// ====================
const initializeDatabase = async (): Promise<Database> => {
  const db = await open({
    filename: "./offline_data.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS payloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      data TEXT NOT NULL,
      retries INTEGER DEFAULT 0,
      last_attempt TEXT
    )
  `);

  return db;
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
  keepalive:60,
});

// ====================
// Constants
// ====================

const constants = {
  POLL_INTERVAL: 10_000,
  REGISTER_READ_DELAY: 300,
  MAX_RETRIES: 5,
  RETRY_BASE_DELAY: 1000,
  DATA_RETENTION_DAYS: 7,
};

let isConnected = false;
// ====================
// Helper Functions
// ====================

// Simple delay function
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Determine register count based on data type (e.g., float needs 2 registers)
function getRegisterCount(dataType: ModbusDataType): number {
  return dataType === "float" ? 2 : 1;
}

// Process register data using type and multiplier
function processRegisterData(
  data: number[],
  reg: DeviceConfig["registers"][0]
): number | null {
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

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T | null> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) {
        console.error(`❌ Failed after ${maxRetries} attempts:`, err);
        break;
      }
      const delayTime = baseDelay * Math.pow(2, attempt); // exponential backoff
      console.warn(`🔁 Retry ${attempt}/${maxRetries} in ${delayTime}ms`);
      await delay(delayTime);
    }
  }
  return null;
}

// ====================
// Modbus Polling & Payload Creation
// ====================

async function pollDevice(device: DeviceConfig): Promise<any> {
  const modbusClient = new ModbusRTU();
  const metrics: Record<string, number> = {}; // Changed to only store numbers

  try {
    console.log(
      `Connecting to ${device.name} at ${device.ip}:${device.port}...`
    );
    await modbusClient.connectTCP(device.ip, { port: device.port });
    modbusClient.setID(device.unit_id);

    for (const reg of device.registers) {
      // Validate address before reading
      if (reg.address < 1 || reg.address > 65535) {
        console.error(`Invalid address ${reg.address} for ${reg.desc}`);
        continue; // Skip invalid addresses
      }

      try {
        const registerCount = getRegisterCount(reg.data_type);
        const raw = await withRetry(() => {
          return reg.type === "input"
            ? modbusClient.readInputRegisters(reg.address - 1, registerCount)
            : modbusClient.readHoldingRegisters(reg.address - 1, registerCount);
        }, constants.MAX_RETRIES, constants.RETRY_BASE_DELAY);
        

        // Validate response structure
        if (!raw?.data || raw.data.length < registerCount) {
          console.warn(`Incomplete data for ${reg.desc}`);
          continue;
        }

        // Process and validate value
        const processedValue = processRegisterData(raw.data, reg);
        if (processedValue !== null && !isNaN(processedValue)) {
          metrics[reg.desc] = processedValue;
        }
      } catch (err) {
        console.error(`Read error for ${reg.desc}:`, err);
      }
      await delay(constants.REGISTER_READ_DELAY);
    }
  } catch (error) {
    console.error(`Device polling failed:`, error);
    return null;
  } finally {
    try {
      await modbusClient.close();
    } catch (error) {
      console.error(`Error closing connection for ${device.name}:`, error);
    }
  }

  // Only return device data if we have valid metrics
  if (Object.keys(metrics).length === 0) return null;

  const map = componentMap[device.name] || {
    key: device.name.toLowerCase(),
    name: device.name,
  };
  return { key: map.key, name: map.name, metrics };
}

async function createPayload() {
  const payloadTimestamp = new Date().toISOString();
  const components: Record<string, any> = {};
  const bessAcMetrics: Record<string, any> = {};

  const mainBessAcDevice = devices.find(d => d.ip === "192.168.1.202");
  const auxBessAcDevice = devices.find(d => d.ip === "192.168.1.203");

   if (mainBessAcDevice) {
    const mainBessAc = await pollDevice(mainBessAcDevice);
    if (mainBessAc?.metrics) {
      Object.assign(bessAcMetrics, mainBessAc.metrics);
    }
  }

  if (auxBessAcDevice) {
    const auxBessAc = await pollDevice(auxBessAcDevice);
    if (auxBessAc?.metrics) {
      Object.assign(bessAcMetrics, auxBessAc.metrics);
    }
  }

  if (Object.keys(bessAcMetrics).length > 0) {
    components["bess_ac"] = {
      name: "BESS AC",
      metrics: bessAcMetrics
    };
  }


  for (const device of devices.filter(d => 
    !["192.168.1.202", "192.168.1.203"].includes(d.ip)
  )) {
    try {
      const data = await pollDevice(device);
      if (data?.metrics) {
        components[data.key] = {
          name: data.name,
          metrics: data.metrics
        };
      }
    } catch (error) {
      console.error(`Failed to poll device ${device.name}:`, error);
    }
  }

  const payload = {
    timestamp: payloadTimestamp,
    site_id: 3,
    components,
  };

  console.log("✅ Payload created:", JSON.stringify(payload, null, 2));
  return payload;
}

// ====================
// IoT Functions
// ====================
const publishToIoT = (payload: any): Promise<boolean> => {
  return new Promise((resolve) => {
    iotDevice.publish("sula_parameters", JSON.stringify(payload), {}, (err) => {
      if (err) {
        console.error("❌ Publish failed:", err);
        return resolve(false);
      }
      console.log("📡 Payload published successfully");
      resolve(true);
    });
  });
};

// ====================
// Offline Handling
// ====================

const savePayloadOffline = async (
  db: Database,
  payload: any
): Promise<void> => {
  if (!isValidPayload(payload)) {
    console.warn("Invalid payload, skipping save");
    return;
  }

  try {
    await db.run("INSERT INTO payloads (timestamp, data) VALUES (?, ?)", [
      new Date().toISOString(),
      JSON.stringify(payload),
    ]);
    console.log("💾 Saved payload to offline storage");
  } catch (error) {
    console.error("Failed to save payload:", error);
  }
};

const retryOfflineData = async (db: Database): Promise<void> => {
  try {
    const batch = await db.all(
      `SELECT * FROM payloads 
       WHERE retries < ? 
       ORDER BY timestamp ASC 
       LIMIT 100`,
      [constants.MAX_RETRIES]
    );

    for (const record of batch) {
      try {
        const payload = JSON.parse(record.data);
        const success = await publishToIoT(payload);

        if (success) {
          await db.run("DELETE FROM payloads WHERE id = ?", [record.id]);
        } else {
          const newRetries = record.retries + 1;
          const delay = constants.RETRY_BASE_DELAY * Math.pow(2, newRetries);

          await db.run(
            "UPDATE payloads SET retries = ?, last_attempt = ? WHERE id = ?",
            [newRetries, new Date().toISOString(), record.id]
          );

          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (err) {
        console.error("Retry failed:", err);
        await db.run("UPDATE payloads SET retries = retries + 1 WHERE id = ?", [
          record.id,
        ]);
      }
    }
  } catch (error) {
    console.error("Batch retry failed:", error);
  }
};

// ====================
// Data Management
// ====================
const cleanupOldData = async (db: Database): Promise<void> => {
  try {
    const retentionDate = new Date();
    retentionDate.setDate(
      retentionDate.getDate() - constants.DATA_RETENTION_DAYS
    );

    await db.run("DELETE FROM payloads WHERE timestamp < ?", [
      retentionDate.toISOString(),
    ]);
    console.log("🧹 Cleaned up old data");
  } catch (error) {
    console.error("Data cleanup failed:", error);
  }
};

const isValidPayload = (payload: any): boolean => {
  return (
    !!payload?.components &&
    Object.keys(payload.components).length > 0 &&
    !isNaN(Date.parse(payload.timestamp))
  );
};

// ====================
// Application Setup
// ====================
const startPolling = (db: Database) => {
  setInterval(async () => {
    try {
      const payload = await createPayload();

      if (isConnected) {
        try {
          const published = await publishToIoT(payload);
          if (!published) await savePayloadOffline(db, payload);
        } catch (publishError) {
          console.error("Publish error:", publishError);
          await savePayloadOffline(db, payload);
        }
      } else {
        console.warn("⚠️ Offline mode - saving locally");
        await savePayloadOffline(db, payload);
      }
    } catch (e) {
      console.error("Polling error:", e);
    }
  }, constants.POLL_INTERVAL);
};

// ====================
// Main Application
// ====================
const main = async () => {
  try {
    const db = await initializeDatabase();

    // Setup cleanup job
    setInterval(() => cleanupOldData(db), 24 * 60 * 60 * 1000);

    // Setup IoT handlers
    iotDevice
      .on("connect", async () => {
        console.log("🔌 Connected to AWS IoT");
        isConnected = true;
        await retryOfflineData(db);
      })
      .on("close", () => {
        console.warn("🔌 Disconnected from AWS IoT");
        isConnected = false;
      });

    // Start polling
    console.log("⏳ Starting data polling");
    startPolling(db);

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\n🛑 Shutting down gracefully...");
      iotDevice.end();
      await db.close();
      process.exit();
    });
  } catch (error) {
    console.error("⚠️ Application failed to initialize:", error);
    process.exit(1);
  }
};

// Start the application
main();
