import "@testing-library/jest-dom/vitest"

// Tests start as if setup had been completed. The wizard tests set this themselves.
if (typeof localStorage !== "undefined") localStorage.setItem("gatehouse.setup", "done")
