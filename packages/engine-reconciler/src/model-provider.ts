/**
 * The model port.
 *
 * ============================================================================
 * THE SAME BARGAIN AS THE IMAGE AND TEXT PORTS, FOR THE SAME REASONS
 * ============================================================================
 * The projector must not know what a model FORMAT is. glTF is here now; USD,
 * FBX and OBJ are the obvious next asks, and every one of them is a change
 * behind this interface and no change at all to projection.
 *
 * VERTEX DATA CROSSES. HANDLES DO NOT. `createGeometry` is called by the
 * projector, because MirrorBackend C2 puts GPU lifetime on the caller — a
 * provider that created geometry would be a second owner of it, which is the
 * bug C2 exists to prevent.
 *
 * The provider is SYNCHRONOUS on purpose. Parsing is asynchronous and belongs
 * to loading: a scene's models are read before its first frame, exactly as
 * fonts and images are, because a stadium that arrives mid-broadcast pops into
 * the shot. Asking here either hits or misses, and a miss draws nothing rather
 * than a placeholder — a stand-in for a sponsor's product is the kind of thing
 * that reaches air.
 */

/** One material's worth of geometry, in the shape `GeometryDescriptor` takes. */
export interface ProvidedMesh {
  readonly positions: Float32Array;
  readonly indices?: Uint32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  /**
   * The material the FILE asked for, already in the engine's vocabulary.
   *
   * Supplied so an imported model looks like itself the moment it lands. A
   * designer overriding it is an ordinary edit to the node's own material
   * props, which is why this is a default and not a lock.
   */
  readonly material?: {
    readonly baseColor: readonly [number, number, number, number];
    readonly metallic: number;
    readonly roughness: number;
    readonly doubleSided: boolean;
    /** Asset id of a base-colour texture, resolvable through `ImageProvider`. */
    readonly baseColorTexture?: string;
  };
}

export interface ModelProvider {
  /**
   * One mesh of a model asset, or undefined if it is not loaded.
   *
   * Indexed rather than returned whole, because a model becomes MANY nodes in
   * the Scene Tree — one per part, so a designer can select the sponsor board
   * without selecting the stadium. Each of those nodes asks for its own mesh.
   */
  mesh(assetId: string, index: number): ProvidedMesh | undefined;

  /** How many meshes the asset has, or 0 when it is not loaded. */
  meshCount(assetId: string): number;
}
