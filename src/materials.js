/**
 * Materials for smoked-glass shards, sliver back button,
 * and text decals with custom cursor-glow shader injection.
 */

export function createGlassMaterials(THREE, S = 1.0) {
  // Shared uniform state for cursor glow
  const cursorUniforms = {
    uCursorWorld: { value: new THREE.Vector3(0, 0, 0) },
    uCursorGlow: { value: 0.0 },
    uGlowRadius: { value: 300.0 * S }
  };

  /**
   * Helper to attach custom lavender cursor glow to a MeshPhysicalMaterial
   */
  function attachCursorGlow(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCursorWorld = cursorUniforms.uCursorWorld;
      shader.uniforms.uCursorGlow = cursorUniforms.uCursorGlow;
      shader.uniforms.uGlowRadius = cursorUniforms.uGlowRadius;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec3 vGlassWorldPos;`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vGlassWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform vec3 uCursorWorld;
         uniform float uCursorGlow;
         uniform float uGlowRadius;
         varying vec3 vGlassWorldPos;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         if (uCursorGlow > 0.0001) {
           float distGlow = length(vGlassWorldPos.xy - uCursorWorld.xy);
           float rad = max(uGlowRadius, 10.0);
           float normDist = distGlow / rad;
           float factor = exp(-1.6 * normDist * normDist) * uCursorGlow;
           vec3 glowColor = vec3(0.42, 0.37, 0.62) * 0.16 * factor;
           gl_FragColor.rgb += glowColor;
         }`
      );
    };
  }

  // Base parameters from prompt
  const baseParams = {
    color: new THREE.Color(0x17171b),
    roughness: 0.36,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
    specularIntensity: 0.7,
    iridescence: 0.55,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [250, 650],
    envMapIntensity: 1.0
  };

  /**
   * Create an individual piece material instance (allows per-piece hover iridescence & envMapIntensity)
   */
  function createPieceMaterial() {
    const mat = new THREE.MeshPhysicalMaterial({ ...baseParams });
    mat.customProgramCacheKey = () => 'glass-glow';
    attachCursorGlow(mat);
    return mat;
  }

  // "← Back" sliver material: iridescence 0.35, no cursor glow
  const sliverMaterial = new THREE.MeshPhysicalMaterial({
    ...baseParams,
    iridescence: 0.35
  });

  return {
    cursorUniforms,
    createPieceMaterial,
    sliverMaterial,
    setGlowRadius: (radius) => {
      cursorUniforms.uGlowRadius.value = radius;
    }
  };
}
