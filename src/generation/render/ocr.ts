import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Text recognition with Apple Vision (research R4), to check a generated visual has no text in it.
 * The Swift source is compiled once into `<home>/bin/ocr`; without a Swift compiler the check is skipped.
 */
const SOURCE = `import Foundation
import Vision
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
let handler = VNImageRequestHandler(url: url)
try handler.perform([request])
for observation in request.results ?? [] {
  if let best = observation.topCandidates(1).first {
    print("\\(best.confidence)\\t\\(best.string)")
  }
}
`;

export interface OcrLine {
  text: string;
  confidence: number;
}

const run = (command: string, args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
    execFile(command, args, { timeout: 60_000 }, (error, stdout, stderr) =>
      resolve({ code: error ? 1 : 0, stdout: String(stdout), stderr: String(stderr) }),
    ),
  );

let compiling: Promise<string | undefined> | undefined;

async function binary(home: string): Promise<string | undefined> {
  const bin = path.join(home, "bin", "ocr");
  if (existsSync(bin)) return bin;
  compiling ??= (async () => {
    if (process.platform !== "darwin") return undefined;
    mkdirSync(path.dirname(bin), { recursive: true });
    const source = path.join(home, "bin", "ocr.swift");
    writeFileSync(source, SOURCE);
    const result = await run("swiftc", ["-O", source, "-o", bin]);
    return result.code === 0 && existsSync(bin) ? bin : undefined;
  })();
  return compiling;
}

/** Recognized text lines, or undefined when OCR is not available here. */
export async function recognizeText(home: string, image: string): Promise<OcrLine[] | undefined> {
  const bin = await binary(home);
  if (!bin) return undefined;
  const result = await run(bin, [image]);
  if (result.code !== 0) return undefined;
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [confidence, ...text] = line.split("\t");
      return { confidence: Number(confidence), text: text.join("\t") };
    });
}
