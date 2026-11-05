/**
 * A conversation's messages as a tree (CH-02, ADR 0015). Each message has a parent; editing a message or asking again
 * makes a sibling, and the conversation's active leaf says which branch is shown. The SDK keeps only the active chain,
 * so Codehouse keeps the tree itself.
 */
export interface TreeNode {
  id: string
  parentId: string | null
  /** Order of creation within the conversation; siblings are shown in this order. */
  seq: number
}

export interface BranchStep<T extends TreeNode> {
  message: T
  /** Every message with the same parent, this one included, oldest first. */
  siblings: string[]
  /** This message's place among them, from 0. */
  index: number
}

export class Tree<T extends TreeNode> {
  readonly #byId = new Map<string, T>()
  readonly #children = new Map<string | null, T[]>()

  constructor(nodes: Iterable<T>) {
    for (const n of nodes) this.#byId.set(n.id, n)
    for (const n of this.#byId.values()) {
      // A parent that is missing (a damaged import) makes the message a root, so nothing is lost.
      const parent = n.parentId !== null && this.#byId.has(n.parentId) ? n.parentId : null
      const list = this.#children.get(parent) ?? []
      list.push(n)
      this.#children.set(parent, list)
    }
    for (const list of this.#children.values()) list.sort((a, b) => a.seq - b.seq)
  }

  get(id: string): T | undefined {
    return this.#byId.get(id)
  }

  children(id: string | null): T[] {
    return this.#children.get(id) ?? []
  }

  /** The newest leaf under a message, following the newest child each time: where a branch you switch to ends. */
  leafFrom(id: string): string {
    let at = id
    const seen = new Set<string>()
    for (;;) {
      seen.add(at)
      const kids = this.children(at)
      const last = kids[kids.length - 1]
      if (!last || seen.has(last.id)) return at
      at = last.id
    }
  }

  /** The chain from the first message down to the leaf. A leaf that is not in the tree gives the newest branch. */
  chain(leaf: string | null): T[] {
    let at = leaf !== null && this.#byId.has(leaf) ? leaf : this.#newestLeaf()
    const out: T[] = []
    const seen = new Set<string>()
    while (at !== undefined && !seen.has(at)) {
      seen.add(at)
      const n = this.#byId.get(at)
      if (!n) break
      out.push(n)
      at = n.parentId !== null && this.#byId.has(n.parentId) ? n.parentId : undefined
    }
    return out.reverse()
  }

  /** The shown branch, each step with its siblings, for the "2 of 3" navigator. */
  branch(leaf: string | null): BranchStep<T>[] {
    return this.chain(leaf).map((message) => {
      const parent =
        message.parentId !== null && this.#byId.has(message.parentId) ? message.parentId : null
      const siblings = this.children(parent).map((s) => s.id)
      return { message, siblings, index: siblings.indexOf(message.id) }
    })
  }

  #newestLeaf(): string | undefined {
    const roots = this.children(null)
    const last = roots[roots.length - 1]
    return last ? this.leafFrom(last.id) : undefined
  }
}
