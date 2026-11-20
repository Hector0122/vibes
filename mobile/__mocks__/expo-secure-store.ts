// Jest stand-in for expo-secure-store (native): an in-memory store.
export const mockStore = new Map<string, string>()

export const getItemAsync = jest.fn(async (k: string) => mockStore.get(k) ?? null)
export const setItemAsync = jest.fn(async (k: string, v: string) => {
  mockStore.set(k, v)
})
export const deleteItemAsync = jest.fn(async (k: string) => {
  mockStore.delete(k)
})
