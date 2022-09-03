<%= (parseInt(version.name.substr(4, 1), 10) > 0) ? '#' : '' %># <%= version.name %> (<%= version.date.getFullYear() %>-<%= ((version.date.getMonth() + 1) < 10) ? '0' : '' %><%= version.date.getMonth() + 1 %>-<%= (version.date.getDate() < 10) ? '0' : '' %><%= version.date.getDate() %>)
<% _.forEach(sections, (section) => { if(section.commitsCount > 0) { %>### <%= section.title %>
<% _.forEach(section.commits, (commit) => { %> - <%= printCommit(commit, true) %><% }) %>
<% _.forEach(section.components.sort((a, b) => a !== b ? a < b ? -1 : 0 : 1), (component) => { %> - **<%= component.name %>:**
<% _.forEach(component.commits, (commit) => { %> <%= (component.commits.length > 1) ? ' -' : '' %> <%= printCommit(commit, true) %><% }) %><% }) %><% } %><% }) %>
