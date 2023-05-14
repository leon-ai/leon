import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <button onClick={() => setCount(count + 1)}>Click me</button>
      <p>hello from React. Count: {count}</p>
    </>
  )
}

export default App
