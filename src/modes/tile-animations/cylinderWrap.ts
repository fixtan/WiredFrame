import * as THREE from 'three';

export function updateCylinderAnimation(
  group: THREE.Group,
  time: number
) {
  // 円柱モードのときはグループ全体をゆっくり回転させる
  group.rotation.y = time * 0.1;

  const total = group.children.length;
  const cols = 10;
  const radius = 12; // 円柱の半径

  group.children.forEach((child, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const totalRows = Math.ceil(total / cols);

    // 円周上の角度を計算
    const angle = (col / cols) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = (row - totalRows / 2) * 2.8;

    const target = new THREE.Vector3(x, y, z);
    child.position.lerp(target, 0.05);

    // 画像が綺麗に円柱の外側を向くように回転を設定
    child.position.set(x, y, z);
    child.lookAt(x * 2, y, z * 2);
  });
}
