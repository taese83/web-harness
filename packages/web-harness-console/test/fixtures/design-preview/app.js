// Minimal committed design-preview fixture for Console traceability tests.
// Entity labels are runtime data; FEAT ownership belongs to their navigation surfaces.
export function renderSidebar() {
  return `
    <nav aria-label="도구 및 테이블 탐색">
      <ul
        data-wh-anchor="wh-feat-002-sidebar-tool-switch"
        data-wh-feature="FEAT-002"
        data-wh-tc="TC-002-2 TC-002-3"
      >
        <li><button type="button">장비 대여 관리</button></li>
        <li><button type="button">이슈 트래커</button></li>
      </ul>
      <ul
        data-wh-anchor="wh-feat-013-sidebar-table-entry"
        data-wh-feature="FEAT-013"
        data-wh-tc="TC-013-1"
      >
        <li><a href="#/tools/tool_seed_issue/tables/table_seed_bug/define">버그 리포트</a></li>
      </ul>
    </nav>
  `
}
