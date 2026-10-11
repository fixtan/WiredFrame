import * as THREE from 'three';

export function updateCardScatterAnimation(
  group: THREE.Group,
  time: number
) {
  // グループ全体をゆっくり回転
  group.rotation.y = time * 0.04;

  group.children.forEach((child, i) => {
    // タイルごとに固有のオフセット（シード値）を与えて、それぞれ違う軌道で漂わせる
    const seed = i * 13.37;
    const x = Math.sin(time * 0.4 + seed) * 14 + Math.cos(time * 0.2 + seed * 2) * 5;
    const y = Math.cos(time * 0.5 + seed * 1.5) * 8 + Math.sin(time * 0.3) * 3;
    const z = Math.sin(time * 0.3 + seed) * 12;

    const target = new THREE.Vector3(x, y, z);
    child.position.lerp(target, 0.05);

    // 漂いながら少しランダムな角度で回転する
    child.rotation.x = Math.sin(time * 0.8 + seed) * 0.4;
    child.rotation.y = Math.cos(time * 0.6 + seed) * 0.4;
    child.rotation.z = Math.sin(time * 0.5 + seed) * 0.2;
  });
}
