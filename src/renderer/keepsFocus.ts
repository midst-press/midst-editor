// Marks a panel whose fields the editor must not take the focus back from on a Mac (GitHub #119): without it,
// what the poet types in that panel goes into the poem. The find bar and the font picker are exempt by class.
const KEEPS_FOCUS = 'data-keeps-focus';
export default KEEPS_FOCUS;
