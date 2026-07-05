import { useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'

function Cube(props) {
    const mesh = useRef()
    const { viewport } = useThree()
    const [hovered, setHover] = useState(false)
    const [active, setActive] = useState(false)
    useFrame(() => (mesh.current.rotation.x = mesh.current.rotation.y += 0.01))
    return (
        <mesh
        {...props}
        ref={mesh}
        scale={(viewport.width / 5) * (active ? 1.5 : 1)}
        onClick={(e) => setActive(!active)}
        onPointerOver={(e) => setHover(true)}
        onPointerOut={(e) => setHover(false)}>
        <boxGeometry />
        <meshStandardMaterial color={hovered ? 'hotpink' : 'orange'} />
        </mesh>
    )
}
export default function App() {
    return (
        <Canvas dpr={[1, 2]}>
        <ambientLight />
        <pointLight position={[0, 0, 0]} />
        <Cube position={[0, 0, 0]} />
        <Cube position={[1.5, 0, 0]} />
        </Canvas>
    )
}

