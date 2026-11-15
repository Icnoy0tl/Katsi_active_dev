import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// Cabecera común de los fragment shaders: variables de entrada y términos Fresnel / iluminación
const FRAGMENT_HEADER = /* glsl */ `
  uniform vec3 lightDirection;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
`;

/** Atmósfera terrestre: azul de día, azul profundo en el crepúsculo */
export const EARTH_ATMOSPHERE_SHADER = /* glsl */ `
  ${FRAGMENT_HEADER}
  uniform vec3 dayColor;
  uniform vec3 twilightColor;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);

    float viewDot = dot(normal, viewDirection);
    float fresnel = pow(clamp(0.68 - viewDot, 0.0, 1.0), 3.1);

    float lightAlignment = dot(normal, normalize(lightDirection));
    float dayFactor = smoothstep(-0.35, 0.75, lightAlignment);

    vec3 finalColor = mix(twilightColor, dayColor, dayFactor);
    float alpha = fresnel * (0.14 + 0.76 * dayFactor);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

/** Atmósfera marciana: tenue halo de polvo anaranjado */
export const MARS_ATMOSPHERE_SHADER = /* glsl */ `
  ${FRAGMENT_HEADER}
  uniform vec3 glowColor;
  uniform vec3 dustColor;

  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);

    float viewDot = dot(normal, viewDirection);
    float fresnel = pow(clamp(0.62 - viewDot, 0.0, 1.0), 3.8);

    float lightAlignment = dot(normal, normalize(lightDirection));
    float dayFactor = smoothstep(-0.35, 0.7, lightAlignment);

    vec3 finalColor = mix(glowColor, dustColor, clamp(lightAlignment + 0.4, 0.0, 1.0));
    float alpha = fresnel * (0.08 + 0.44 * dayFactor);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

/**
 * Halo atmosférico Fresnel (esfera vista por dentro con mezcla aditiva).
 * `lightDirectionUniform` se comparte entre atmósferas: al actualizarlo una vez, se actualizan todas.
 */
export function createAtmosphere({ radius, segments, fragmentShader, colors, lightDirectionUniform }) {
  const uniforms = { lightDirection: lightDirectionUniform };
  Object.entries(colors).forEach(([name, hex]) => {
    uniforms[name] = { value: new THREE.Color(hex) };
  });

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });

  return new THREE.Mesh(new THREE.SphereGeometry(radius, segments, segments), material);
}
