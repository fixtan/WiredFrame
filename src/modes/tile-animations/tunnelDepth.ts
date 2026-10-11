import * as THREE from 'three';

export function updateTunnelAnimation(
  group: THREE.Group,
  time: number
) {
  // トンネルの回転
  group.rotation.y = time * 0.2;
  const total = group.children.length;

  group.children.forEach((child, i) => {
    // 奥（Z軸方向）へ円状に並べ、手前に流れて循環するようなトンネル効果を作る
    const zDepth = ((i * 1.2 - time * 6.0) % 30) - 15;
    const angle = (i / total) * Math.PI * 6;
    const radius = 10;

    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = zDepth;

    const target = new THREE.Vector3(x, y, z);
    child.position.lerp(target, 0.1);

    // トンネルの内側を向くように回転
    child.lookAt(0, 0, z - 10);
  });
}
