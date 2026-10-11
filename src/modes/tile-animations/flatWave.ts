import * as THREE from 'three';

export function updateTileAnimation(
  group: THREE.Group,
  time: number,
  isSphereLayout: boolean
) {
  // 球体モードのときはグループ全体をゆっくり自動回転させる
  if (isSphereLayout) {
    group.rotation.y = time * 0.05;
  } else {
    group.rotation.y = 0; // 平面に戻ったら回転をリセット
  }

  group.children.forEach((child) => {
    const baseTarget = isSphereLayout
      ? (child.userData.spherePos as THREE.Vector3)
      : (child.userData.flatPos as THREE.Vector3);

    let target = baseTarget.clone();

    // 平面モードのときだけ、有機的に波打つオフセットをZ軸に加える
    if (!isSphereLayout) {
      const col = child.userData.colIndex;
      const row = child.userData.rowIndex;
      const waveZ = Math.sin(time * 1.5 + col * 0.5 + row * 0.4) * 1.2;
      target.z += waveZ;
    }

    // なめらかに補間
    child.position.lerp(target, 0.05);

    if (isSphereLayout) {
      child.lookAt(0, 0, 0);
    } else {
      // 波のうねりに合わせて少しだけ傾きをつける
      const col = child.userData.colIndex;
      const row = child.userData.rowIndex;
      const tiltX = Math.cos(time * 1.5 + row * 0.4) * 0.08;
      const tiltY = Math.sin(time * 1.5 + col * 0.5) * 0.08;
      child.rotation.set(tiltX, tiltY, 0);
    }
  });
}
