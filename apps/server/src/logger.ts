type Level = "debug" | "info" | "warn" | "error";

type Fields = Record<string, unknown>;

interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

function emit(level: Level, msg: string, bindings: Fields, fields?: Fields): void {
  const record = {
    time: new Date().toISOString(),
    level,
    msg,
    ...bindings,
    ...(fields ?? {}),
  };
  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

function build(bindings: Fields): Logger {
  return {
    debug(msg, fields) {
      emit("debug", msg, bindings, fields);
    },
    info(msg, fields) {
      emit("info", msg, bindings, fields);
    },
    warn(msg, fields) {
      emit("warn", msg, bindings, fields);
    },
    error(msg, fields) {
      emit("error", msg, bindings, fields);
    },
    child(extra) {
      return build({ ...bindings, ...extra });
    },
  };
}

export const logger: Logger = build({ app: "chesstalk-server" });
export type { Logger };
