/**
 * GraphQL query strings for GitHub Projects V2 API.
 *
 * These queries are extracted for reusability and testability.
 * Each query is a template string that can be used with @octokit/graphql.
 */

/**
 * Query to get the current authenticated user
 */
export const VIEWER_QUERY = `
    query {
        viewer {
            login
        }
    }
`;

/**
 * Query to get projects linked to a repository
 */
export const REPOSITORY_PROJECTS_QUERY = `
    query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
            projectsV2(first: 20) {
                nodes {
                    id
                    title
                    number
                    url
                }
            }
        }
    }
`;

/**
 * Query to get the repository ID
 */
export const REPOSITORY_ID_QUERY = `
    query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
            id
        }
    }
`;

/**
 * Query to get project items with all field values
 */
export const PROJECT_ITEMS_QUERY = `
    query($projectId: ID!) {
        node(id: $projectId) {
            ... on ProjectV2 {
                items(first: 100) {
                    nodes {
                        id
                        fieldValues(first: 20) {
                            nodes {
                                __typename
                                ... on ProjectV2ItemFieldSingleSelectValue {
                                    name
                                    field { ... on ProjectV2SingleSelectField { name } }
                                }
                                ... on ProjectV2ItemFieldTextValue {
                                    text
                                    field { ... on ProjectV2Field { name } }
                                }
                                ... on ProjectV2ItemFieldNumberValue {
                                    number
                                    field { ... on ProjectV2Field { name } }
                                }
                                ... on ProjectV2ItemFieldDateValue {
                                    date
                                    field { ... on ProjectV2Field { name } }
                                }
                                ... on ProjectV2ItemFieldIterationValue {
                                    title
                                    field { ... on ProjectV2IterationField { name } }
                                }
                            }
                        }
                        content {
                            __typename
                            ... on Issue {
                                title
                                number
                                url
                                state
                                issueType { name }
                                assignees(first: 5) { nodes { login } }
                                labels(first: 10) { nodes { name color } }
                                repository { name }
                            }
                            ... on PullRequest {
                                title
                                number
                                url
                                state
                                merged
                                assignees(first: 5) { nodes { login } }
                                labels(first: 10) { nodes { name color } }
                                repository { name }
                            }
                            ... on DraftIssue {
                                title
                            }
                        }
                    }
                }
            }
        }
    }
`;

/**
 * Query to get project fields (including status options)
 */
export const PROJECT_FIELDS_QUERY = `
    query($projectId: ID!) {
        node(id: $projectId) {
            ... on ProjectV2 {
                fields(first: 30) {
                    nodes {
                        __typename
                        ... on ProjectV2Field {
                            id
                            name
                        }
                        ... on ProjectV2SingleSelectField {
                            id
                            name
                            options { id name }
                        }
                        ... on ProjectV2IterationField {
                            id
                            name
                        }
                    }
                }
            }
        }
    }
`;

/**
 * Query to get project views
 */
export const PROJECT_VIEWS_QUERY = `
    query($projectId: ID!) {
        node(id: $projectId) {
            ... on ProjectV2 {
                views(first: 20) {
                    nodes {
                        name
                        filter
                    }
                }
            }
        }
    }
`;

/**
 * Mutation to update a project item field value
 */
export const UPDATE_ITEM_FIELD_MUTATION = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
        updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: $value
        }) {
            projectV2Item { id }
        }
    }
`;

/**
 * Legacy mutation for updating single select field (status)
 */
export const UPDATE_ITEM_STATUS_MUTATION = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
        }) {
            projectV2Item { id }
        }
    }
`;

/**
 * Mutation to create a new issue
 */
export const CREATE_ISSUE_MUTATION = `
    mutation($repositoryId: ID!, $title: String!, $body: String) {
        createIssue(input: {
            repositoryId: $repositoryId
            title: $title
            body: $body
        }) {
            issue {
                id
                number
            }
        }
    }
`;

/**
 * Mutation to add an item to a project
 */
export const ADD_TO_PROJECT_MUTATION = `
    mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {
            projectId: $projectId
            contentId: $contentId
        }) {
            item { id }
        }
    }
`;

/**
 * Query to get full issue details including comments
 */
export const ISSUE_DETAILS_QUERY = `
    query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
            issueOrPullRequest(number: $number) {
                __typename
                ... on Issue {
                    title
                    body
                    state
                    createdAt
                    author { login }
                    labels(first: 10) { nodes { name color } }
                    comments(first: 50) {
                        totalCount
                        nodes {
                            author { login }
                            body
                            createdAt
                        }
                    }
                }
                ... on PullRequest {
                    title
                    body
                    state
                    createdAt
                    author { login }
                    labels(first: 10) { nodes { name color } }
                    comments(first: 50) {
                        totalCount
                        nodes {
                            author { login }
                            body
                            createdAt
                        }
                    }
                }
            }
        }
    }
`;

/**
 * Query to get issue/PR node ID
 */
export const ISSUE_NODE_ID_QUERY = `
    query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
            issueOrPullRequest(number: $number) {
                ... on Issue { id }
                ... on PullRequest { id }
            }
        }
    }
`;

/**
 * Mutation to add a comment
 */
export const ADD_COMMENT_MUTATION = `
    mutation($subjectId: ID!, $body: String!) {
        addComment(input: { subjectId: $subjectId, body: $body }) {
            commentEdge {
                node { id }
            }
        }
    }
`;

/**
 * Query to get repository collaborators
 */
export const COLLABORATORS_QUERY = `
    query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
            collaborators(first: 50) {
                nodes { login name }
            }
            assignableUsers(first: 50) {
                nodes { login name }
            }
        }
    }
`;

/**
 * Query to get recent issues
 */
export const RECENT_ISSUES_QUERY = `
    query($owner: String!, $name: String!, $limit: Int!) {
        repository(owner: $owner, name: $name) {
            issues(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
                nodes {
                    number
                    title
                    state
                }
            }
        }
    }
`;

/**
 * Query to check if a label exists
 */
export const LABEL_EXISTS_QUERY = `
    query($owner: String!, $name: String!, $labelName: String!) {
        repository(owner: $owner, name: $name) {
            label(name: $labelName) {
                id
            }
        }
    }
`;

/**
 * Query to get issue and label IDs for adding labels
 */
export const ISSUE_AND_LABEL_QUERY = `
    query($owner: String!, $name: String!, $number: Int!, $labelName: String!) {
        repository(owner: $owner, name: $name) {
            issue(number: $number) {
                id
            }
            label(name: $labelName) {
                id
            }
        }
    }
`;

/**
 * Mutation to add labels to an issue
 */
export const ADD_LABELS_MUTATION = `
    mutation($issueId: ID!, $labelIds: [ID!]!) {
        addLabelsToLabelable(input: { labelableId: $issueId, labelIds: $labelIds }) {
            clientMutationId
        }
    }
`;

/**
 * Mutation to remove labels from an issue
 */
export const REMOVE_LABELS_MUTATION = `
    mutation($issueId: ID!, $labelIds: [ID!]!) {
        removeLabelsFromLabelable(input: { labelableId: $issueId, labelIds: $labelIds }) {
            clientMutationId
        }
    }
`;

/**
 * Query to find issues with a specific label
 */
export const ISSUES_WITH_LABEL_QUERY = `
    query($owner: String!, $name: String!, $labels: [String!]) {
        repository(owner: $owner, name: $name) {
            issues(first: 10, labels: $labels, states: [OPEN]) {
                nodes {
                    number
                }
            }
        }
    }
`;

/**
 * Query to get available issue types for a repository
 */
export const ISSUE_TYPES_QUERY = `
    query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
            issueTypes(first: 20) {
                nodes {
                    id
                    name
                }
            }
        }
    }
`;

/**
 * Query to get issue node ID for updating
 */
export const ISSUE_FOR_UPDATE_QUERY = `
    query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
            issue(number: $number) {
                id
            }
        }
    }
`;

/**
 * Mutation to update issue type
 */
export const UPDATE_ISSUE_TYPE_MUTATION = `
    mutation($issueId: ID!, $issueTypeId: ID!) {
        updateIssue(input: { id: $issueId, issueTypeId: $issueTypeId }) {
            issue {
                id
            }
        }
    }
`;

/**
 * Mutation to update issue body/description
 */
export const UPDATE_ISSUE_BODY_MUTATION = `
    mutation($issueId: ID!, $body: String!) {
        updateIssue(input: { id: $issueId, body: $body }) {
            issue {
                id
            }
        }
    }
`;
