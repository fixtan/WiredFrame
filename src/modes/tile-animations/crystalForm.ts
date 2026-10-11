import * as THREE from 'three';

export function updateCrystalAnimation(
  group: THREE.Group,
  time: number
) {
  // 全体を立体的に傾けつつ、結晶のように回転させる
  group.rotation.y = time * 0.08;
  group.rotation.x = Math.sin(time * 0.3) * 0.2;

  const total = group.children.length;
  const cols = 10;

  group.children.forEach((child, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const angle = (col / cols) * Math.PI * 2;

    // 幾何学的な結晶・ピラミッド状のレイアウトを計算
    const heightLayer = (row - 2.5) * 1.8;
    const r = 6 + Math.abs(row - 2.5) * 2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = heightLayer;

    const target = new THREE.Vector3(x, y, z);
    child.position.lerp(target, 0.1);

    // 結晶の中心を向く
    child.lookAt(0, y, 0);
  });
}
