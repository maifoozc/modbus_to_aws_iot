// src/index.ts
import { createModbusConnection } from "./modbus_tcp_service";
import { Buffer } from "buffer";
import { DeviceConfig, RegisterType, ModbusDataType } from "./types/modbus";

const bessAcConfig: DeviceConfig = {
  name: "BESS",
  ip: "192.168.1.202",
  port: 2,
  unit_id: 1,
  registers: [
    {
      address: 1,
      desc: "voltage_phase_r",
      type: "input" as RegisterType,
      data_type: "float" as ModbusDataType,
      multiplier: 1,
    },
    {
      address: 3,
      desc: "voltage_phase_y",
      type: "input" as RegisterType,
      data_type: "float" as ModbusDataType,
      multiplier: 1,
    },
    {
      address: 5,
      desc: "voltage_phase_b",
      type: "input" as RegisterType,
      data_type: "float" as ModbusDataType,
      multiplier: 1,
    },
    {
      address: 9,
      desc: "voltage_ry",
      type: "input" as RegisterType,
      data_type: "float" as ModbusDataType,
      multiplier: 1,
    },
    {
      address: 11,
      desc: "voltage_yb",
      type: "input" as RegisterType,
      data_type: "float" as ModbusDataType,
      multiplier: 1,
    },
    {
      address: 13,
      desc: "voltage_br",
      type: "input" as RegisterType,
      data_type: "float" as ModbusDataType,
      multiplier: 1,
    },
  ],
};

async function testBessAcVoltages() {
  let connection: any = null;
  try {
    connection = createModbusConnection(bessAcConfig);

    // Add error handler for connection errors
    connection.on("error", (err: Error) => {
      console.error("Modbus connection error:", err.message);
    });

    console.log(
      `Connecting to ${bessAcConfig.name} at ${bessAcConfig.ip}:${bessAcConfig.port}...`
    );
    await connection.connect();
    console.log("Modbus connection established successfully!\n");

    // Increased initial delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    for (const register of bessAcConfig.registers) {
      try {
        // Read 2 registers for float values
        const rawValues = await connection.readInputRegisters(
          register.address - 1,
          2
        );

        if (!rawValues || !Array.isArray(rawValues)) {
          throw new Error(`Invalid response: ${JSON.stringify(rawValues)}`);
        }

        console.log(`${register.desc} (Address: ${register.address}):`);
        console.log(`  Raw Values:`, rawValues);

        // Try all possible byte order combinations
        const buffer = Buffer.alloc(4);

        // Option 1: Big-endian
        buffer.writeUInt16BE(rawValues[0], 0);
        buffer.writeUInt16BE(rawValues[1], 2);
        console.log(`  Option 1 (BE): ${buffer.readFloatBE(0).toFixed(2)} V`);

        // Option 2: Word-swapped
        buffer.writeUInt16BE(rawValues[1], 0);
        buffer.writeUInt16BE(rawValues[0], 2);
        console.log(`  Option 2 (SW): ${buffer.readFloatBE(0).toFixed(2)} V`);

        // Increased delay between reads
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        console.error(
          `❌ Failed to read ${register.desc}:`,
          error instanceof Error ? error.message : String(error)
        );

        // Reset connection on error
        if (connection) {
          try {
            await connection.close();
            console.log("Reconnecting...");
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await connection.connect();
          } catch (e) {
            console.error(
              "Reconnection failed:",
              e instanceof Error ? e.message : String(e)
            );
          }
        }
      }
    }
  } catch (error) {
    console.error(
      "❌ Modbus operation failed:",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    if (connection?.close) {
      try {
        await connection.close();
        console.log("\nConnection closed");
      } catch (closeError) {
        console.error(
          "Error closing connection:",
          closeError instanceof Error ? closeError.message : String(closeError)
        );
      }
    }
    console.log("Test completed");
  }
}

testBessAcVoltages();
