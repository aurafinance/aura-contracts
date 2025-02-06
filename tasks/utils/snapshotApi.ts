import { gql, request } from "graphql-request";
import { configs as snapshotConfig } from "../../tasks/snapshot/constants";
export interface Proposal {
    id: string;
    title: string;
    scores_total: number;
    scores: number[];
    choices: string[];
    scores_state: string;
    start: number;
    end: number;
}
export async function getLatestSnapshotResults() {
    const ssConfig = snapshotConfig.main;
    const query = gql`
        query Proposals($space: String!) {
            proposals(first: 5, where: { space: $space, state: "closed" }, orderBy: "created", orderDirection: desc) {
                id
                title
                scores_total
                scores
                choices
                scores_state
                end
                start
            }
        }
    `;
    const data = await request<{ proposals: Proposal[] }>(`${ssConfig.hub}/graphql`, query, { space: ssConfig.space });
    return data.proposals.find(proposal => proposal.title.startsWith("Gauge Weight for Week"));
}

export async function getSnapshotResults(proposalId: string) {
    const ssConfig = snapshotConfig.main;
    const query = gql`
        query Proposal($proposal: String!) {
            proposal(id: $proposal) {
                id
                title
                scores_total
                scores
                choices
                scores_state
                end
                start
            }
        }
    `;
    const proposal = (await request(`${ssConfig.hub}/graphql`, query, { proposal: proposalId }))[
        "proposal"
    ] as Proposal;
    return proposal;
}
