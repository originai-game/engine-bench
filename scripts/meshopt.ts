// meshopt.ts <in.glb> <out.glb>: meshopt-codes a glTF's buffers
// (EXT_meshopt_compression) as they are. The shipped models are already
// quantized by gltfpack (KHR_mesh_quantization); gltf-transform's `meshopt`
// command quantizes again and breaks them, so only the coding is applied.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: meshopt.ts <in.glb> <out.glb>");
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(input);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(output, doc);
