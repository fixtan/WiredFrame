import * as THREE from 'three';

export function updateSpiralAnimation(
  group: THREE.Group,
  time: number
) {
  // グループ全体をゆっくり回転させる
  group.rotation.y = time * 0.1;

  const total = group.children.length;

  group.children.forEach((child, i) => {
    // らせん状のターゲット座標を動的に計算
    const t = (i / total) * Math.PI * 8 + time * 0.05;
    const radius = 10 + Math.sin(i * 0.5 + time * 0.2) * 3;
    const x = Math.cos(t) * radius;
    const y = (i - total / 2) * 0.4 + Math.sin(time + i) * 0.5;
    const z = Math.sin(t) * radius;

    const target = new THREE.Vector3(x, y, z);

    child.position.lerp(target, 0.05);
    child.lookAt(0, y, 0); // らせんの中心を向く
  });
}
