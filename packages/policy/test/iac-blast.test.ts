// E-024: the blast radius of an apply: what depends on each resource it deletes or replaces, from the plan's graph.
import { describe, expect, it } from "vitest"
import { blastRadius, parsePlan } from "../src/iac-plan.js"

const ref = (...r: string[]) => ({ references: r })
/** A virtual network, its subnet, a NIC in the subnet, a machine on the NIC, and a data source reading the network. */
const vnetPlan = {
  format_version: "1.2",
  resource_changes: [
    { address: "azurerm_virtual_network.main", type: "azurerm_virtual_network", change: { actions: ["delete", "create"] } },
    { address: "azurerm_subnet.app", type: "azurerm_subnet", change: { actions: ["no-op"] } },
    { address: "azurerm_linux_virtual_machine.web[0]", type: "azurerm_linux_virtual_machine", change: { actions: ["no-op"] } },
  ],
  configuration: {
    root_module: {
      resources: [
        { address: "azurerm_virtual_network.main", expressions: { name: { constant_value: "vnet" } } },
        { address: "azurerm_subnet.app", expressions: { virtual_network_name: ref("azurerm_virtual_network.main.name", "azurerm_virtual_network.main") } },
        { address: "azurerm_network_interface.web", expressions: { ip_configuration: [{ subnet_id: ref("azurerm_subnet.app.id", "azurerm_subnet.app") }] } },
        { address: "azurerm_linux_virtual_machine.web", expressions: { network_interface_ids: ref("azurerm_network_interface.web.id") } },
        { address: "data.azurerm_virtual_network.read", expressions: { name: ref("azurerm_virtual_network.main.name") } },
        { address: "azurerm_storage_account.logs", expressions: {} },
      ],
      module_calls: {
        dns: { module: { resources: [{ address: "azurerm_private_dns_zone_virtual_network_link.l", expressions: {}, depends_on: ["azurerm_virtual_network.main"] }] } },
      },
    },
  },
}

describe("the blast radius of an apply", () => {
  it("lists a replaced virtual network's subnets and machines, through the resources between", () => {
    expect(blastRadius(parsePlan(vnetPlan)!)).toEqual([
      {
        resource: "azurerm_virtual_network.main",
        action: "replace",
        dependents: ["azurerm_linux_virtual_machine.web", "azurerm_network_interface.web", "azurerm_subnet.app"],
        more: 0,
      },
    ])
  })

  it("follows Pulumi's dependencies, and lists only what something depends on", () => {
    const urn = (t: string, n: string) => `urn:pulumi:dev::net::${t}::${n}`
    const vnet = urn("azure-native:network:VirtualNetwork", "vnet")
    const subnet = urn("azure-native:network:Subnet", "app")
    const vm = urn("azure-native:compute:VirtualMachine", "web")
    const plan = parsePlan({
      steps: [
        { op: "replace", urn: vnet, newState: { type: "azure-native:network:VirtualNetwork", dependencies: [] } },
        { op: "same", urn: subnet, newState: { type: "azure-native:network:Subnet", dependencies: [vnet] } },
        { op: "same", urn: vm, newState: { type: "azure-native:compute:VirtualMachine", dependencies: [subnet] } },
        { op: "delete", urn: urn("azure-native:storage:StorageAccount", "logs"), oldState: { type: "azure-native:storage:StorageAccount" } },
      ],
    })!
    expect(blastRadius(plan)).toEqual([{ resource: vnet, action: "replace", dependents: [subnet, vm].sort(), more: 0 }])
  })

  it("finds a counted resource's dependents by its configuration address", () => {
    const b = blastRadius(parsePlan({
      format_version: "1",
      resource_changes: [{ address: 'aws_vpc.main["eu"]', type: "aws_vpc", change: { actions: ["delete"] } }],
      configuration: { root_module: { resources: [{ address: "aws_vpc.main", expressions: {} }, { address: "aws_subnet.a", expressions: { vpc_id: ref('aws_vpc.main["eu"].id', "aws_vpc.main") } }] } },
    })!)
    expect(b).toEqual([{ resource: 'aws_vpc.main["eu"]', action: "delete", dependents: ["aws_subnet.a"], more: 0 }])
  })

  it("caps the list and says how many more", () => {
    const resources = [{ address: "aws_vpc.main", expressions: {} }, ...Array.from({ length: 35 }, (_, i) => ({ address: `aws_subnet.s${String(i).padStart(2, "0")}`, expressions: { vpc_id: ref("aws_vpc.main.id") } }))]
    const b = blastRadius(parsePlan({ format_version: "1", resource_changes: [{ address: "aws_vpc.main", type: "aws_vpc", change: { actions: ["delete"] } }], configuration: { root_module: { resources } } })!)
    expect(b[0]).toMatchObject({ action: "delete", more: 5 })
    expect(b[0]!.dependents).toHaveLength(30)
  })
})
