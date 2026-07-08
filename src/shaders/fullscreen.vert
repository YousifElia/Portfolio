// ============================================================================
// fullscreen.vert  —  shared vertex shader for fullscreen-quad passes
// Expects a unit triangle/quad covering NDC [-1,1]² (PlaneGeometry(2,2)).
// ============================================================================

out vec2 vUv;

void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
