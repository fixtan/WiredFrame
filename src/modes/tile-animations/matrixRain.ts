import * as THREE from 'three';

export function updateMatrixAnimation(
  group: THREE.Group,
  time: number
) {
  group.rotation.y = 0;
  const cols = (group.userData.cols as number) || 10;

  group.children.forEach((child, i) => {
    const col = i % cols;
    const baseTarget = child.userData.flatPos as THREE.Vector3;
    let target = baseTarget.clone();

    // 列ごとに異なるスピードで上下にデジタル雨のように流す
    const speed = 0.5 + (col % 3) * 1.2;
    const yOffset = ((time * speed + i * 0.5) % 16) - 8.0;

    target.y += yOffset;
    target.z += Math.cos(time * 2 + i * 0.2) * 0.3;

    child.position.lerp(target, 0.1);
    child.rotation.set(0, 0, 0);
  });
}
