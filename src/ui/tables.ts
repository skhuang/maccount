import type { Strings } from "../i18n";
import { h, helpHint } from "./components";

type TableFilterOption = { value: string; label: string };

export function tableTools(
  t: Strings,
  tableId: string,
  total: number,
  filters: TableFilterOption[] = [],
): string {
  const count = t.table_showing.replace("{visible}", String(total)).replace("{total}", String(total));
  const filter = filters.length
    ? `<label>${t.table_filter_label}<select data-table-status>
  <option value="">${t.table_filter_all}</option>
  ${filters.map((f) => `<option value="${h(f.value)}">${h(f.label)}</option>`).join("")}
</select></label>`
    : "";
  return `<div class="table-tools" data-table-tools data-table-id="${h(tableId)}">
  <label>${t.table_search_label}${helpHint(t.help_table_search, t.help_label)}<input type="search" data-table-search placeholder="${t.table_search_placeholder}" autocomplete="off"></label>
  ${filter}
  <p class="table-count" data-table-count data-template="${h(t.table_showing)}" aria-live="polite">${h(count)}</p>
</div>`;
}

export function sortableTh(
  label: string,
  column: number,
  type: "text" | "number" = "text",
  className = "",
): string {
  return `<th${className ? ` class="${h(className)}"` : ""} data-sort-column="${column}" data-sort-type="${type}">${h(label)}</th>`;
}

export function uiEnhancements(t: Strings): string {
  return `<dialog class="confirm-dialog" data-confirm-dialog aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
  <div class="confirm-dialog__body">
    <h2 id="confirm-dialog-title">${t.confirm_dialog_title}</h2>
    <p id="confirm-dialog-message"></p>
    <div class="confirm-dialog__actions">
      <button type="button" class="button button--secondary" data-confirm-cancel>${t.confirm_cancel}</button>
      <button type="button" class="button button--danger" data-confirm-submit>${t.confirm_continue}</button>
    </div>
  </div>
</dialog><script>(()=>{
const normalize=(value)=>value.normalize("NFKC").toLocaleLowerCase();
document.querySelectorAll("[data-table-tools]").forEach((tools)=>{
  const table=document.getElementById(tools.dataset.tableId||"");
  if(!table)return;
  const rows=[...table.querySelectorAll("tbody tr[data-row]")];
  const search=tools.querySelector("[data-table-search]");
  const status=tools.querySelector("[data-table-status]");
  const count=tools.querySelector("[data-table-count]");
  const noResults=document.createElement("tr");
  noResults.hidden=true;noResults.dataset.noResults="";
  const noResultsCell=document.createElement("td");
  noResultsCell.colSpan=table.tHead?.rows[0]?.cells.length||1;
  noResultsCell.className="empty-cell";noResultsCell.textContent=${JSON.stringify(t.table_no_results)};
  noResults.append(noResultsCell);table.tBodies[0]?.append(noResults);
  const apply=()=>{
    const query=normalize(search?.value.trim()||"");
    const wanted=status?.value||"";
    let visible=0;
    rows.forEach((row)=>{
      const matchesText=!query||normalize(row.textContent||"").includes(query);
      const matchesStatus=!wanted||row.dataset.status===wanted;
      row.hidden=!(matchesText&&matchesStatus);
      if(!row.hidden)visible++;
    });
    noResults.hidden=visible!==0||rows.length===0;
    if(count)count.textContent=(count.dataset.template||"").replace("{visible}",String(visible)).replace("{total}",String(rows.length));
  };
  search?.addEventListener("input",apply);
  status?.addEventListener("change",apply);
  table.querySelectorAll("th[data-sort-column]").forEach((header)=>{
    const column=Number(header.dataset.sortColumn||0);
    const type=header.dataset.sortType||"text";
    const label=header.textContent||"";
    const button=document.createElement("button");
    button.type="button";button.className="sort-button";button.append(document.createTextNode(label));
    const icon=document.createElement("span");icon.className="sort-icon";icon.setAttribute("aria-hidden","true");icon.textContent="↕";button.append(icon);
    header.textContent="";header.append(button);header.setAttribute("aria-sort","none");
    button.addEventListener("click",()=>{
      const ascending=header.getAttribute("aria-sort")!=="ascending";
      table.querySelectorAll("th[aria-sort]").forEach((item)=>{
        item.setAttribute("aria-sort","none");
        const otherIcon=item.querySelector(".sort-icon");if(otherIcon)otherIcon.textContent="↕";
      });
      header.setAttribute("aria-sort",ascending?"ascending":"descending");
      icon.textContent=ascending?"↑":"↓";
      [...rows].sort((a,b)=>{
        const av=(a.cells[column]?.dataset.sortValue||a.cells[column]?.textContent||"").trim();
        const bv=(b.cells[column]?.dataset.sortValue||b.cells[column]?.textContent||"").trim();
        const compared=type==="number"?(Number(av)||0)-(Number(bv)||0):av.localeCompare(bv,undefined,{numeric:true,sensitivity:"base"});
        return ascending?compared:-compared;
      }).forEach((row)=>table.tBodies[0]?.insertBefore(row,noResults));
    });
  });
});
document.querySelectorAll("[data-copy-path],[data-copy-target]").forEach((button)=>{
  const original=button.textContent||"";
  const finish=(ok)=>{
    button.textContent=ok?${JSON.stringify(t.copied)}:${JSON.stringify(t.copy_failed)};
    window.setTimeout(()=>{button.textContent=original;},1600);
  };
  button.addEventListener("click",()=>{
    const target=button.dataset.copyTarget?document.getElementById(button.dataset.copyTarget):null;
    const value=target?("value" in target?target.value:target.textContent||""):new URL(button.dataset.copyPath||"/",location.origin).href;
    if(navigator.clipboard?.writeText){
      navigator.clipboard.writeText(value).then(()=>finish(true),()=>finish(false));
      return;
    }
    const area=document.createElement("textarea");
    area.value=value;area.style.position="fixed";area.style.opacity="0";document.body.append(area);area.select();
    let ok=false;try{ok=document.execCommand("copy");}catch{}area.remove();finish(ok);
  });
});
const closeHelp=(hint)=>{
  if(!hint)return;
  const toggle=hint.querySelector("[data-help-toggle]");
  const panel=hint.querySelector("[data-help-panel]");
  if(toggle)toggle.setAttribute("aria-expanded","false");
  if(panel)panel.hidden=true;
};
const openHelp=(hint)=>{
  if(!hint)return;
  const toggle=hint.querySelector("[data-help-toggle]");
  const panel=hint.querySelector("[data-help-panel]");
  document.querySelectorAll("[data-help-hint].is-open").forEach((other)=>{if(other!==hint){other.classList.remove("is-open");closeHelp(other);}});
  hint.classList.add("is-open");
  if(toggle)toggle.setAttribute("aria-expanded","true");
  if(panel)panel.hidden=false;
};
document.querySelectorAll("[data-help-hint]").forEach((hint)=>{
  const toggle=hint.querySelector("[data-help-toggle]");
  toggle?.addEventListener("click",(event)=>{
    event.stopPropagation();
    if(hint.dataset.openedByFocus==="true"){delete hint.dataset.openedByFocus;openHelp(hint);return;}
    if(hint.classList.contains("is-open")){hint.classList.remove("is-open");closeHelp(hint);return;}
    openHelp(hint);
  });
  toggle?.addEventListener("focus",()=>{hint.dataset.openedByFocus="true";openHelp(hint);});
  hint.addEventListener("pointerenter",()=>openHelp(hint));
  hint.addEventListener("pointerleave",()=>{if(document.activeElement!==toggle){hint.classList.remove("is-open");closeHelp(hint);}});
});
document.addEventListener("click",(event)=>{
  document.querySelectorAll("[data-help-hint].is-open").forEach((hint)=>{
    if(!hint.contains(event.target)){hint.classList.remove("is-open");closeHelp(hint);}
  });
});
document.addEventListener("keydown",(event)=>{
  if(event.key==="Escape"){
    document.querySelectorAll("[data-help-hint].is-open").forEach((hint)=>{hint.classList.remove("is-open");closeHelp(hint);});
  }
});
const confirmDialog=document.querySelector("[data-confirm-dialog]");
if(confirmDialog){
  const title=confirmDialog.querySelector("#confirm-dialog-title");
  const message=confirmDialog.querySelector("#confirm-dialog-message");
  const cancel=confirmDialog.querySelector("[data-confirm-cancel]");
  const proceed=confirmDialog.querySelector("[data-confirm-submit]");
  let pendingForm=null;
  document.querySelectorAll("form[data-confirm-message]").forEach((form)=>{
    form.addEventListener("submit",(event)=>{
      if(form.dataset.confirmed==="true"){delete form.dataset.confirmed;return;}
      if(form.dataset.confirmWhen==="replace"&&!form.querySelector('[name="replace"]:checked'))return;
      event.preventDefault();pendingForm=form;
      if(title)title.textContent=form.dataset.confirmTitle||${JSON.stringify(t.confirm_dialog_title)};
      if(message)message.textContent=form.dataset.confirmMessage||"";
      if(proceed)proceed.textContent=form.dataset.confirmAction||${JSON.stringify(t.confirm_continue)};
      confirmDialog.showModal();
    });
  });
  cancel?.addEventListener("click",()=>confirmDialog.close());
  proceed?.addEventListener("click",()=>{
    const form=pendingForm;if(!form)return;
    form.dataset.confirmed="true";confirmDialog.close();form.requestSubmit();
  });
  confirmDialog.addEventListener("close",()=>{pendingForm=null;});
}
})();</script>`;
}
