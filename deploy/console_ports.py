"""Production role/port contract. Service identity stays stable when ports move."""
LEGACY_PORT = 13001
V2_PORT = 13000
PORTS = {"prediction-console": LEGACY_PORT, "prediction-console-v2": V2_PORT}
