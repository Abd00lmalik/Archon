"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { GraphEdge, GraphNode, TaskGraph } from "@/lib/graph";

interface SubmissionGraphProps {
  graph: TaskGraph;
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId: string | null;
}

type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimLink = d3.SimulationLinkDatum<SimNode> & GraphEdge;

function nodeKey(node: SimNode) {
  return node.id;
}

function nodeFromLinkEnd(end: string | number | SimNode): SimNode | null {
  if (typeof end === "string" || typeof end === "number") return null;
  return end;
}

const nodeStyle = {
  human_submission: { fill: "#00E5FF", stroke: "#0099AA", size: 14 },
  agent_submission: { fill: "#BF00FF", stroke: "#6B00A8", size: 14 },
  human_response: { fill: "#101E2D", stroke: "#00E5FF", size: 10 },
  agent_response: { fill: "#0D0518", stroke: "#BF00FF", size: 10 },
  selected: { fill: "#F5A623", stroke: "#D4891C", size: 18 }
};

const edgeStyle = {
  builds_on: { color: "#00E5FF", width: 1.5, dash: "none", opacity: 0.5 },
  critiques: { color: "#FF6B35", width: 1.5, dash: "4,4", opacity: 0.5 },
  alternative: { color: "#BF00FF", width: 1.5, dash: "2,6", opacity: 0.5 }
};

export default function SubmissionGraph({ graph, onNodeClick, selectedNodeId }: SubmissionGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || graph.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const nodes: SimNode[] = graph.nodes.map((item) => ({ ...item }));
    const links: SimLink[] = graph.edges.map((item) => ({ ...item }));

    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    const pattern = defs
      .append("pattern")
      .attr("id", "grid")
      .attr("width", 40)
      .attr("height", 40)
      .attr("patternUnits", "userSpaceOnUse");
    pattern
      .append("path")
      .attr("d", "M 40 0 L 0 0 0 40")
      .attr("fill", "none")
      .attr("stroke", "#162334")
      .attr("stroke-width", "0.5");
    svg.append("rect").attr("width", "100%").attr("height", "100%").attr("fill", "url(#grid)");

    const container = svg.append("g");
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });
    svg.call(zoom);

    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links).id(nodeKey).distance(130))
      .force("charge", d3.forceManyBody<SimNode>().strength(-280))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius(34));

    const link = container
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (item) => edgeStyle[item.type].color)
      .attr("stroke-width", (item) => edgeStyle[item.type].width)
      .attr("stroke-dasharray", (item) => edgeStyle[item.type].dash)
      .attr("opacity", (item) => edgeStyle[item.type].opacity);

    const node = container
      .append("g")
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (item) => {
        if (item.id === selectedNodeId || item.isSelected) return nodeStyle.selected.size;
        const key = `${item.isAgent ? "agent" : "human"}_${item.type}` as keyof typeof nodeStyle;
        return Math.max(nodeStyle[key].size, nodeStyle[key].size + item.responseCount * 1.5);
      })
      .attr("fill", (item) => {
        if (item.id === selectedNodeId || item.isSelected) return nodeStyle.selected.fill;
        const key = `${item.isAgent ? "agent" : "human"}_${item.type}` as keyof typeof nodeStyle;
        return nodeStyle[key].fill;
      })
      .attr("stroke", (item) => {
        if (item.id === selectedNodeId || item.isSelected) return nodeStyle.selected.stroke;
        const key = `${item.isAgent ? "agent" : "human"}_${item.type}` as keyof typeof nodeStyle;
        return nodeStyle[key].stroke;
      })
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGCircleElement, SimNode>()
          .on("start", (event, item) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            item.fx = item.x;
            item.fy = item.y;
          })
          .on("drag", (event, item) => {
            item.fx = event.x;
            item.fy = event.y;
          })
          .on("end", (event, item) => {
            if (!event.active) simulation.alphaTarget(0);
            item.fx = null;
            item.fy = null;
          })
      )
      .on("click", (event, item) => {
        event.stopPropagation();
        onNodeClick(item);
      });

    const labels = container
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((item) => (item.isAgent ? "A" : "H"))
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "#020608")
      .attr("font-size", "9px")
      .style("font-weight", "700")
      .style("pointer-events", "none");

    node.append("title").text((item) => `${item.isAgent ? "[Agent]" : "[Human]"} ${item.submitterAddress.slice(0, 10)}...`);

    simulation.on("tick", () => {
      link
        .attr("x1", (item) => nodeFromLinkEnd(item.source)?.x ?? 0)
        .attr("y1", (item) => nodeFromLinkEnd(item.source)?.y ?? 0)
        .attr("x2", (item) => nodeFromLinkEnd(item.target)?.x ?? 0)
        .attr("y2", (item) => nodeFromLinkEnd(item.target)?.y ?? 0);

      node.attr("cx", (item) => item.x ?? 0).attr("cy", (item) => item.y ?? 0);
      labels.attr("x", (item) => item.x ?? 0).attr("y", (item) => item.y ?? 0);
    });

    return () => {
      simulation.stop();
    };
  }, [graph, onNodeClick, selectedNodeId]);

  return <svg ref={svgRef} className="graph-container h-full w-full" style={{ minHeight: "520px", background: "#020608" }} />;
}
