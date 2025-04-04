import ModbusRTU from "modbus-serial";
import { Buffer } from "buffer";
import { DeviceConfig } from "./types/modbus";
import * as iot from "aws-iot-device-sdk";
import * as path from "path";

// Modbus Configuration
const bessAcConfig: DeviceConfig = {
  name: "BESS-AC",
  ip: "192.168.1.202",
  port: 2, // Changed to standard Modbus TCP port 502
  unit_id: 1,
  registers: [
    { address: 1, desc: "voltage_phase_r", type: "input", data_type: "float", multiplier: 1 },
    { address: 3, desc: "voltage_phase_y", type: "input", data_type: "float", multiplier: 1 },
    { address: 5, desc: "voltage_phase_b", type: "input", data_type: "float", multiplier: 1 },
    { address: 9, desc: "voltage_ry", type: "input", data_type: "float", multiplier: 1 },
    { address: 11, desc: "voltage_yb", type: "input", data_type: "float", multiplier: 1 },
    { address: 13, desc: "voltage_br", type: "input", data_type: "float", multiplier: 1 },
  ],
};

// AWS IoT Configuration
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

async function collectAndPublishData() {
  const client = new ModbusRTU();
  const timestamp = new Date().toISOString();
  const readings: Record<string, number> = {};

  try {
    // Connect to Modbus device
    console.log(`Connecting to ${bessAcConfig.name} at ${bessAcConfig.ip}:${bessAcConfig.port}...`);
    await client.connectTCP(bessAcConfig.ip, { port: bessAcConfig.port });
    client.setID(bessAcConfig.unit_id);
    console.log("Modbus connection established!");

    // Collect all register data
    for (const register of bessAcConfig.registers) {
      try {
        const rawValues = await client.readInputRegisters(register.address - 1, 2);
        
        if (rawValues?.data?.length >= 2) {
          const buffer = Buffer.alloc(4);
          buffer.writeUInt16LE(rawValues.data[0], 0);
          buffer.writeUInt16LE(rawValues.data[1], 2);
          const voltage = buffer.readFloatLE(0) * register.multiplier;
          readings[register.desc] = parseFloat(voltage.toFixed(2));
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`❌ Error reading ${register.desc}:`)
     
      }
    }

    // Prepare and publish consolidated payload
    const payload = {
      device: bessAcConfig.name,
      timestamp,
      readings,
      status: Object.values(readings).every(val => val !== null) ? "healthy" : "partial",
      new:"new"
    };

    iotDevice.publish("sula_parameters", JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) {
        console.error("❌ Publish failed:", err);
      } else {
        console.log("📤 Published all readings:", 
          Object.keys(readings).length, "values");
        console.log("Sample values:", 
          Object.entries(readings).slice(0, 2).map(([k,v]) => `${k}:${v}V`));
      }
    });

  } catch (error) {
    console.error("❌ Modbus operation failed:", 
      error instanceof Error ? error.message : String(error));
  } finally {
    try {
      await client.close();
      console.log("Modbus connection closed");
    } catch (closeError) {
      console.error("Error closing connection:", 
        closeError instanceof Error ? closeError.message : String(closeError));
    }
  }
}

// Event Handlers
iotDevice
  .on("connect", () => {
    console.log("✅ Connected to AWS IoT");
    setInterval(collectAndPublishData, 5000); // Poll every 5 seconds
    collectAndPublishData(); // Immediate first poll
  })
  .on("error", (err) => console.error("AWS IoT Error:", err))
  .on("offline", () => console.log("AWS IoT Offline"));

// Graceful Shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  iotDevice.end();
  process.exit(0);
});