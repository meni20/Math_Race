import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const os = require("node:os");

os.hostname = () => "ascii-host";
syncBuiltinESMExports();
