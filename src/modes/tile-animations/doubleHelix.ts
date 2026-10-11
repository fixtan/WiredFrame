import * as THREE from 'three';

export function updateDoubleHelixAnimation(
  group: THREE.Group,
  time: number
) {
  group.rotation.y = time * 0.15;
  const total = group.children.length;

  group.children.forEach((child, i) => {
    // 偶数番目と奇数番目で逆方向に回る二重らせんを作る
    const isEven = i % 2 === 0;
    const dir = isEven ? 1 : -1;
    const t = (i / total) * Math.PI * 4 + time * 0.5 * dir;

    const radius = 12;
    const x = Math.cos(t) * radius;
    const y = (i - total / 2) * 0.3 + Math.sin(time * 2 + i * 0.1) * 1.5;
    const z = Math.sin(t) * radius * dir;

    const target = new THREE.Vector3(x, y, z);
    child.position.lerp(target, 0.1);

    // 中心に向かって綺麗に向かわせる
    child.lookAt(0, y, 0);
  });
}
