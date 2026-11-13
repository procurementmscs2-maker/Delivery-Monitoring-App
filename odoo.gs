

/****************************************************
 * DELIVERY MONITORING SYSTEM
 * ODOO XML-RPC CONNECTION
 ****************************************************/

/**
 * Get Odoo credentials from Script Properties.
 */
function odooGetConfig_() {
  const properties = PropertiesService.getScriptProperties();

  const config = {
    url: properties.getProperty("ODOO_URL"),
    db: properties.getProperty("ODOO_DB"),
    username: properties.getProperty("ODOO_USERNAME"),
    apiKey: properties.getProperty("ODOO_API_KEY")
  };

  for (const key in config) {
    if (!config[key]) {
      throw new Error("Missing Odoo configuration: " + key);
    }
  }

  config.url = config.url.replace(/\/+$/, "");

  return config;
}


/**
 * XML-RPC connection and authentication.
 */
function odooGetConnection_() {
  const config = odooGetConfig_();

  const uid = odooXmlRpcCall_(
    config.url + "/xmlrpc/2/common",
    "authenticate",
    [config.db, config.username, config.apiKey, {}]
  );

  if (!uid || typeof uid !== "number") {
    throw new Error(
      "Odoo authentication failed. Check your URL, database, username, and API key."
    );
  }

  return {
    url: config.url,
    db: config.db,
    uid: uid,
    apiKey: config.apiKey
  };
}


/**
 * Execute an Odoo XML-RPC method.
 */
function odooExecuteKw_(
  connection,
  model,
  method,
  args,
  kwargs
) {
  const params = [
    connection.db,
    connection.uid,
    connection.apiKey,
    model,
    method,
    args || []
  ];

  if (kwargs !== undefined && kwargs !== null) {
    params.push(kwargs);
  }

  return odooXmlRpcCall_(
    connection.url + "/xmlrpc/2/object",
    "execute_kw",
    params
  );
}


/**
 * Send XML-RPC request.
 */
function odooXmlRpcCall_(endpoint, method, params) {
  const xmlParams = params.map(function(value) {
    return "<param>" + odooXmlBuildValue_(value) + "</param>";
  }).join("");

  const xml =
    '<?xml version="1.0"?>' +
    '<methodCall>' +
      '<methodName>' + odooXmlEscape_(method) + '</methodName>' +
      '<params>' + xmlParams + '</params>' +
    '</methodCall>';

  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "text/xml",
    payload: xml,
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      "Odoo HTTP error " + status + ": " + body.substring(0, 500)
    );
  }

  const document = XmlService.parse(body);
  const root = document.getRootElement();

  const fault = root.getChild("fault");

  if (fault) {
    const faultData = odooXmlParseValue_(fault.getChild("value"));

    throw new Error(
      "Odoo XML-RPC fault: " + JSON.stringify(faultData)
    );
  }

  const paramsElement = root.getChild("params");

  if (!paramsElement) {
    throw new Error("Invalid Odoo XML-RPC response.");
  }

  const param = paramsElement.getChild("param");

  if (!param) {
    throw new Error("Odoo response contains no result.");
  }

  return odooXmlParseValue_(param.getChild("value"));
}


/**
 * Convert JavaScript values to XML-RPC values.
 */
function odooXmlBuildValue_(value) {
  if (value === null || value === undefined) {
    return "<value><string></string></value>";
  }

  if (typeof value === "boolean") {
    return "<value><boolean>" +
      (value ? "1" : "0") +
      "</boolean></value>";
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid XML-RPC number.");
    }

    if (Number.isInteger(value)) {
      return "<value><int>" + value + "</int></value>";
    }

    return "<value><double>" + value + "</double></value>";
  }

  if (typeof value === "string") {
    return "<value><string>" +
      odooXmlEscape_(value) +
      "</string></value>";
  }

  if (Array.isArray(value)) {
    const items = value.map(odooXmlBuildValue_).join("");

    return "<value><array><data>" +
      items +
      "</data></array></value>";
  }

  if (typeof value === "object") {
    let members = "";

    Object.keys(value).forEach(function(key) {
      members +=
        "<member>" +
          "<name>" + odooXmlEscape_(key) + "</name>" +
          odooXmlBuildValue_(value[key]) +
        "</member>";
    });

    return "<value><struct>" + members + "</struct></value>";
  }

  throw new Error("Unsupported XML-RPC data type.");
}


/**
 * Convert XML-RPC response to JavaScript values.
 */
function odooXmlParseValue_(element) {
  if (!element) return null;

  const children = element.getChildren();

  if (children.length === 0) {
    return element.getText();
  }

  const type = children[0].getName();
  const node = children[0];
  const value = node.getText();

  switch (type) {
    case "string":
      return value;

    case "int":
    case "i4":
      return parseInt(value, 10);

    case "double":
      return parseFloat(value);

    case "boolean":
      return value === "1";

    case "nil":
      return null;

    case "array":
      const data = node.getChild("data");

      return data
        ? data.getChildren("value").map(odooXmlParseValue_)
        : [];

    case "struct":
      const result = {};

      node.getChildren("member").forEach(function(member) {
        const name = member.getChildText("name");

        result[name] = odooXmlParseValue_(
          member.getChild("value")
        );
      });

      return result;

    default:
      return value;
  }
}


/**
 * Escape XML special characters.
 */
function odooXmlEscape_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


/****************************************************
 * CONNECTION TEST
 ****************************************************/

function testOdooConnection() {
  try {
    const connection = odooGetConnection_();

    const version = odooXmlRpcCall_(
      connection.url + "/xmlrpc/2/common",
      "version",
      []
    );

    Logger.log("==================================");
    Logger.log("ODOO CONNECTION SUCCESSFUL");
    Logger.log("==================================");
    Logger.log("Database: " + connection.db);
    Logger.log("User ID: " + connection.uid);
    Logger.log("Odoo Version: " + version.server_version);
    Logger.log("==================================");

    return {
      success: true,
      database: connection.db,
      uid: connection.uid,
      version: version.server_version
    };

  } catch (error) {
    Logger.log("ODOO CONNECTION FAILED: " + error.message);
    throw error;
  }
}


/****************************************************
 * GENERAL ODOO HELPERS
 ****************************************************/

/**
 * Retrieve all records from an Odoo model.
 */
function odooSearchReadAll_(
  connection,
  model,
  domain,
  fields,
  order
) {
  const batchSize = 500;
  let offset = 0;
  let allRecords = [];

  while (true) {
    const batch = odooExecuteKw_(
      connection,
      model,
      "search_read",
      [domain || []],
      {
        fields: fields,
        limit: batchSize,
        offset: offset,
        order: order || "id asc"
      }
    );

    if (!Array.isArray(batch)) {
      throw new Error(
        "Unexpected response while retrieving " + model
      );
    }

    allRecords = allRecords.concat(batch);

    if (batch.length < batchSize) break;

    offset += batchSize;
  }

  return allRecords;
}


/**
 * Convert Odoo many2one values into readable names.
 */
function odooGetRelationName_(value) {
  if (Array.isArray(value)) {
    return value[1] || "";
  }

  return value || "";
}


/**
 * Get helper lookup.
 *
 * Includes inactive helpers so existing assignments
 * can still display their names in the dashboard.
 */
function odooGetHelperMap_(connection) {
  const helpers = odooSearchReadAll_(
    connection,
    "x_delivery_helpers",
    [],
    ["id", "x_name", "x_studio_helper_name", "x_active"],
    "id asc"
  );

  const helperMap = {};

  helpers.forEach(function(helper) {
    helperMap[helper.id] =
      helper.x_studio_helper_name ||
      helper.x_name ||
      "Unknown Helper";
  });

  return helperMap;
}


/**
 * Convert helper IDs to readable names.
 */
function odooGetHelperNames_(helperIds, helperMap) {
  return (helperIds || []).map(function(id) {
    return helperMap[id] || "Unknown Helper";
  });
}



/****************************************************
 * DELIVERY DASHBOARD DATA
 ****************************************************/

/**
 * Retrieve active delivery records.
 *
 * Categories:
 * NEW
 * ONGOING
 * FINISHED
 * WITH CONCERNS
 */

function getDeliveryDashboardData(token) {
  const sessionUser = getSessionUser(token);

  if (!sessionUser) {
    throw new Error("Your session has expired. Please log in again.");
  }

  const role = String(sessionUser.role || "").trim().toUpperCase();
  const fullName = String(sessionUser.fullName || "").trim();

  if (!["ADMIN", "MANAGER", "ENCODER", "HELPER"].includes(role)) {
    throw new Error("You are not authorized to access the dashboard.");
  }

  if (role === "HELPER" && !fullName) {
    throw new Error(
      "Your account needs a FULL NAME. Contact your administrator."
    );
  }

  const connection = odooGetConnection_();
  const helperMap = odooGetHelperMap_(connection);

  const records = odooSearchReadAll_(
    connection,
    "x_delivery_records",
    [["x_active", "=", true]],
    [
      "id",
      "x_name",
      "x_studio_invoice_number",
      "x_studio_sales_order_number",
      "x_studio_customer_name",
      "x_studio_sales_representative",
      "x_studio_delivery_date",
      "x_studio_area",
      "x_studio_driver",
      "x_studio_helper_1",
      "x_studio_truck",
      "x_studio_trip_id",
      "x_studio_delivery_type",
      "x_studio_status",
      "x_studio_delivery_remarks",
      "x_studio_return_to_area_today",
      "x_studio_stage_id"
    ],
    "id desc"
  );

  const visibleRecords = records.filter(function(record) {
    if (["ADMIN", "MANAGER", "ENCODER"].includes(role)) {
      return true;
    }

    if (role === "HELPER") {
      const helperNames = odooGetHelperNames_(
        record.x_studio_helper_1 || [],
        helperMap
      );

      const driverName = odooGetRelationName_(
        record.x_studio_driver
      );

      const targetName = fullName.toLowerCase();

      const isAssignedHelper = helperNames.some(function(name) {
        return String(name).trim().toLowerCase() === targetName;
      });

      const isAssignedDriver =
        String(driverName).trim().toLowerCase() === targetName;

      return isAssignedHelper || isAssignedDriver;
    }

    return false;
  });

  const newDeliveries = [];
  const ongoingDeliveries = [];
  const finishedDeliveries = [];
  const concernDeliveries = [];

  const ongoingStatuses = [
    "SCHEDULED",
    "READY FOR DELIVERY",
    "DEPARTED",
    "IN TRANSIT",
    "ARRIVED"
  ];

  const concernStatuses = [
    "DELIVERED - WITH CANCELLED ITEM(S)",
    "DELIVERED - WITH INVOICE CONCERN",
    "DELIVERED - WITH ITEM(S) TO FOLLOW",
    "DELIVERED - WITH COA TO FOLLOW",
    "DELIVERY ATTEMPT UNSUCCESSFUL (1)",
    "DELIVERY ATTEMPT UNSUCCESSFUL (2)",
    "BACKLOAD",
    "CANCELLED"
  ];

  const statusCounts = {};

  visibleRecords.forEach(function(record) {
    const helperIds = record.x_studio_helper_1 || [];

    const helperNames = odooGetHelperNames_(
      helperIds,
      helperMap
    );

    const delivery = {
      id: record.id,
      invoiceNumber:
        record.x_studio_invoice_number || record.x_name || "",
      salesOrderNumber: record.x_studio_sales_order_number || "",
      customerName: record.x_studio_customer_name || "",
      salesRepresentative: odooGetRelationName_(
        record.x_studio_sales_representative
      ),
      deliveryDate: record.x_studio_delivery_date || "",
      area: record.x_studio_area || "",
      driver: odooGetRelationName_(record.x_studio_driver),
      helperNames: helperNames,
      helperIds: helperIds,
      truck: record.x_studio_truck || "",
      tripId: record.x_studio_trip_id || "",
      // True while another invoice in this trip is still an unfinished stop:
      // IN TRANSIT, or ARRIVED but awaiting its delivery result.
      tripHasActiveTransit: !!String(record.x_studio_trip_id || "").trim() &&
        records.some(function(otherRecord) {
          const otherStatus = String(otherRecord.x_studio_status || "")
            .trim().toUpperCase();
          return Number(otherRecord.id) !== Number(record.id) &&
            String(otherRecord.x_studio_trip_id || "").trim() ===
              String(record.x_studio_trip_id || "").trim() &&
            ["IN TRANSIT", "ARRIVED"].includes(otherStatus);
        }),
      deliveryType: record.x_studio_delivery_type || "",
      status: record.x_studio_status || "",
      deliveryRemarks: record.x_studio_delivery_remarks || "",
      returnToAreaToday: record.x_studio_return_to_area_today === true,
      stage: record.x_studio_stage_id || false
    };

    const status = String(delivery.status || "")
      .trim()
      .toUpperCase();

    statusCounts[status || "(BLANK)"] =
      (statusCounts[status || "(BLANK)"] || 0) + 1;

    if (status === "PENDING") {
      newDeliveries.push(delivery);

    } else if (status === "DELIVERED SUCCESSFULLY") {
      finishedDeliveries.push(delivery);

    } else if (ongoingStatuses.includes(status) ||
      (status === "DELIVERY ATTEMPT UNSUCCESSFUL (1)" && delivery.returnToAreaToday)) {
      ongoingDeliveries.push(delivery);

    } else {
      // Any other status goes into WITH CONCERNS.
      concernDeliveries.push(delivery);
    }
  });

  const categorizedTotal =
    newDeliveries.length +
    ongoingDeliveries.length +
    finishedDeliveries.length +
    concernDeliveries.length;

  Logger.log("===== DASHBOARD CATEGORY DEBUG =====");
  Logger.log("Role: " + role);
  Logger.log("Odoo active records: " + records.length);
  Logger.log("Visible records: " + visibleRecords.length);
  Logger.log("NEW: " + newDeliveries.length);
  Logger.log("ONGOING: " + ongoingDeliveries.length);
  Logger.log("FINISHED: " + finishedDeliveries.length);
  Logger.log("CONCERNS: " + concernDeliveries.length);
  Logger.log("Categorized total: " + categorizedTotal);
  Logger.log("Raw status counts: " + JSON.stringify(statusCounts));

  if (categorizedTotal !== visibleRecords.length) {
    throw new Error(
      "Dashboard categorization mismatch. Visible: " +
      visibleRecords.length +
      ", Categorized: " + categorizedTotal
    );
  }

  return {
    success: true,
    totalRecords: visibleRecords.length,

    newCount: newDeliveries.length,
    ongoingCount: ongoingDeliveries.length,
    finishedCount: finishedDeliveries.length,
    concernCount: concernDeliveries.length,

    newDeliveries: newDeliveries,
    ongoingDeliveries: ongoingDeliveries,
    finishedDeliveries: finishedDeliveries,
    concernDeliveries: concernDeliveries,

    statusCounts: statusCounts
  };
}


/****************************************************
 * DELIVERY ASSIGNMENT OPTIONS
 ****************************************************/

/**
 * Get active helpers for the assignment editor.
 */
function getDeliveryAssignmentOptions(token) {
  const sessionUser = getSessionUser(token);

  if (!sessionUser) {
    throw new Error("Your session has expired. Please log in again.");
  }

  const role = String(sessionUser.role || "").trim().toUpperCase();

  if (!["ADMIN", "MANAGER", "ENCODER"].includes(role)) {
    throw new Error("You are not authorized to edit assignments.");
  }

  const connection = odooGetConnection_();

  const helpers = odooSearchReadAll_(
    connection,
    "x_delivery_helpers",
    [["x_active", "=", true]],
    ["id", "x_name", "x_studio_helper_name"],
    "id asc"
  );

  return {
    success: true,
    helpers: helpers.map(function(helper) {
      return {
        id: helper.id,
        name:
          helper.x_studio_helper_name ||
          helper.x_name ||
          "Unknown Helper"
      };
    })
  };
}


/****************************************************
 * AUDIT LOG HELPERS
 ****************************************************/

/**
 * Create audit entries in the existing Odoo model.
 */
function odooCreateAuditLogs_(
  connection,
  auditRows
) {
  if (!auditRows || !auditRows.length) return;

  return odooExecuteKw_(
    connection,
    "x_delivery_audit_logs",
    "create",
    [auditRows]
  );
}


/**
 * Get audit timestamp.
 */
function odooGetAuditTimestamp_() {
  return Utilities.formatDate(
    new Date(),
    "UTC",
    "yyyy-MM-dd HH:mm:ss"
  );
}


/**
 * Return the Odoo Datetime field that tracks the latest entry into a
 * delivery movement status. Other statuses do not have movement timestamps.
 */
function odooGetMovementTimestampField_(status) {
  const fields = {
    "DEPARTED": "x_studio_departed",
    "IN TRANSIT": "x_studio_in_transit",
    "ARRIVED": "x_studio_arrived"
  };

  return fields[String(status || "").trim().toUpperCase()] || "";
}


/**
 * Get audit user information.
 */
function odooGetAuditUser_(sessionUser, role) {
  const roleLabels = {
    ADMIN: "Admin",
    MANAGER: "Manager",
    ENCODER: "Encoder",
    HELPER: "Helper"
  };

  const userName = String(
    sessionUser.fullName || sessionUser.username || ""
  ).trim();

  const userRole = roleLabels[role];

  if (!userName || !userRole) {
    throw new Error("Unable to identify the editing user.");
  }

  return {
    userName: userName,
    userRole: userRole
  };
}


/****************************************************
 * RETRIEVE DELIVERY AUDIT LOGS
 ****************************************************/

/**
 * Validate access to audit logs.
 *
 * Uses the existing dashboard roles.
 */
function validateAuditLogAccess_(token) {
  const sessionUser = getSessionUser(token);

  if (!sessionUser) {
    throw new Error("Your session has expired. Please log in again.");
  }

  const role = String(
    sessionUser.role || ""
  ).trim().toUpperCase();

  if (!["ADMIN", "MANAGER", "ENCODER", "HELPER"].includes(role)) {
    throw new Error("You are not authorized to view audit logs.");
  }

  return sessionUser;
}


/**
 * Convert an Odoo audit log into a website-friendly object.
 */
function odooFormatAuditLog_(log) {
  const deliveryRecord = log.x_studio_delivery_record || false;

  return {
    id: log.id,
    name: log.x_name || "",
    invoiceNumber: log.x_studio_invoice_number || "",
    deliveryRecordId: Array.isArray(deliveryRecord)
      ? deliveryRecord[0]
      : deliveryRecord || "",
    action: log.x_studio_action || "",
    timestamp: log.x_studio_deliver_monitoring_timestamp || "",
    user: log.x_studio_user || "",
    userRole: log.x_studio_user_role || "",
    field: log.x_studio_field || "",
    oldValue: log.x_studio_old_value || "",
    newValue: log.x_studio_new_value || "",
    reason: log.x_studio_change_justification || "",
    transactionId: log.x_studio_transaction_id || ""
  };
}


/**
 * Retrieve ALL audit logs.
 *
 * Used by the main website AUDIT LOGS tab.
 */
function getDeliveryAuditLogs(token) {
  validateAuditLogAccess_(token);

  const connection = odooGetConnection_();

  const logs = odooSearchReadAll_(
    connection,
    "x_delivery_audit_logs",
    [],
    [
      "id",
      "x_name",
      "x_studio_action",
      "x_studio_change_justification",
      "x_studio_deliver_monitoring_timestamp",
      "x_studio_delivery_record",
      "x_studio_field",
      "x_studio_invoice_number",
      "x_studio_new_value",
      "x_studio_old_value",
      "x_studio_transaction_id",
      "x_studio_user",
      "x_studio_user_role"
    ],
    "x_studio_deliver_monitoring_timestamp desc, id desc"
  );

  return {
    success: true,
    totalCount: logs.length,
    logs: logs.map(odooFormatAuditLog_)
  };
}


/**
 * Retrieve audit logs for ONE invoice.
 *
 * Used by the invoice-specific VIEW HISTORY button.
 *
 * recordId is the Odoo x_delivery_records ID,
 * not the invoice number.
 */
function getInvoiceAuditLogs(token, recordId) {
  validateAuditLogAccess_(token);

  recordId = Number(recordId);

  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Invalid Delivery Record ID.");
  }

  const connection = odooGetConnection_();

  const logs = odooSearchReadAll_(
    connection,
    "x_delivery_audit_logs",
    [
      ["x_studio_delivery_record", "=", recordId]
    ],
    [
      "id",
      "x_name",
      "x_studio_action",
      "x_studio_change_justification",
      "x_studio_deliver_monitoring_timestamp",
      "x_studio_delivery_record",
      "x_studio_field",
      "x_studio_invoice_number",
      "x_studio_new_value",
      "x_studio_old_value",
      "x_studio_transaction_id",
      "x_studio_user",
      "x_studio_user_role"
    ],
    "x_studio_deliver_monitoring_timestamp desc, id desc"
  );

  return {
    success: true,
    recordId: recordId,
    totalCount: logs.length,
    logs: logs.map(odooFormatAuditLog_)
  };
}

/****************************************************
 * REGULAR DELIVERY ASSIGNMENT EDITING
 ****************************************************/

/**
 * Save delivery assignment changes.
 *
 * Editable:
 * - Area
 * - Truck
 * - Driver
 * - Helper(s)
 *
 * Every changed field gets its own audit log.
 */
function saveDeliveryAssignment(
  token,
  recordId,
  changes,
  reason
) {
  const sessionUser = getSessionUser(token);

  if (!sessionUser) {
    throw new Error("Your session has expired. Please log in again.");
  }

  const role = String(sessionUser.role || "").trim().toUpperCase();

  if (!["ADMIN", "MANAGER", "ENCODER"].includes(role)) {
    throw new Error(
      "You are not authorized to edit delivery assignments."
    );
  }

  recordId = Number(recordId);

  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("Invalid Delivery Record ID.");
  }

  if (!changes || typeof changes !== "object") {
    throw new Error("No assignment changes were provided.");
  }

  reason = String(reason || "").trim();

  if (!reason) {
    throw new Error("Reason for Change is required before saving.");
  }

  if (reason.length > 2000) {
    throw new Error("Reason cannot exceed 2,000 characters.");
  }

  const connection = odooGetConnection_();

  const records = odooSearchReadAll_(
    connection,
    "x_delivery_records",
    [
      ["id", "=", recordId],
      ["x_active", "=", true]
    ],
    [
      "id",
      "x_studio_invoice_number",
      "x_studio_area",
      "x_studio_truck",
      "x_studio_driver",
      "x_studio_helper_1"
    ],
    "id asc"
  );

  if (!records.length) {
    throw new Error("Delivery Record not found or inactive.");
  }

  const record = records[0];
  const helperMap = odooGetHelperMap_(connection);


  const updateValues = {};
  const rollbackValues = {};
  const auditChanges = [];

  function addTextChange(
    inputKey,
    fieldName,
    fieldLabel,
    oldValue
  ) {
    if (!Object.prototype.hasOwnProperty.call(changes, inputKey)) {
      return;
    }

    const newValue = String(changes[inputKey] ?? "").trim();
    const previousValue = String(oldValue || "").trim();

    if (newValue === previousValue) return;

    updateValues[fieldName] = newValue;
    rollbackValues[fieldName] = oldValue || false;

    auditChanges.push({
      field: fieldLabel,
      oldValue: previousValue,
      newValue: newValue
    });
  }

  addTextChange(
    "area",
    "x_studio_area",
    "Area",
    record.x_studio_area
  );

  addTextChange(
    "truck",
    "x_studio_truck",
    "Truck",
    record.x_studio_truck
  );

  addTextChange(
    "driver",
    "x_studio_driver",
    "Driver",
    record.x_studio_driver
  );

  if (
    Object.prototype.hasOwnProperty.call(changes, "helperIds")
  ) {
    if (!Array.isArray(changes.helperIds)) {
      throw new Error("Invalid helper selection.");
    }

    const activeHelpers = odooSearchReadAll_(
      connection,
      "x_delivery_helpers",
      [["x_active", "=", true]],
      ["id"],
      "id asc"
    );

    const activeHelperIds = new Set(
      activeHelpers.map(function(helper) {
        return Number(helper.id);
      })
    );

    const newHelperIds = changes.helperIds.map(function(id) {
      const numberId = Number(id);

      if (
        !Number.isInteger(numberId) ||
        numberId <= 0 ||
        !activeHelperIds.has(numberId)
      ) {
        throw new Error(
          "A selected helper is inactive or does not exist."
        );
      }

      return numberId;
    });

    const uniqueHelperIds = [...new Set(newHelperIds)];

    const oldHelperIds = (
      record.x_studio_helper_1 || []
    ).map(Number);

    const oldSorted = oldHelperIds.slice().sort(function(a, b) {
      return a - b;
    });

    const newSorted = uniqueHelperIds.slice().sort(function(a, b) {
      return a - b;
    });

    const sameHelpers =
      JSON.stringify(oldSorted) === JSON.stringify(newSorted);

    if (!sameHelpers) {
      updateValues.x_studio_helper_1 = [
        [6, 0, uniqueHelperIds]
      ];

      rollbackValues.x_studio_helper_1 = [
        [6, 0, oldHelperIds]
      ];

      auditChanges.push({
        field: "Helper(s)",
        oldValue: odooGetHelperNames_(
          oldHelperIds,
          helperMap
        ).join(", "),
        newValue: odooGetHelperNames_(
          uniqueHelperIds,
          helperMap
        ).join(", ")
      });
    }
  }

  if (!auditChanges.length) {
    throw new Error("No changes were detected.");
  }

  const transactionId = Utilities.getUuid();
  const timestamp = odooGetAuditTimestamp_();
  const auditUser = odooGetAuditUser_(sessionUser, role);

  const writeResult = odooExecuteKw_(
    connection,
    "x_delivery_records",
    "write",
    [[recordId], updateValues]
  );

  if (writeResult !== true) {
    throw new Error("Odoo could not save the assignment changes.");
  }

  const auditRows = auditChanges.map(function(change) {
    return {
      x_name:
        record.x_studio_invoice_number +
        " - " + change.field,
      x_studio_action: "UPDATE",
      x_studio_change_justification: reason,
      x_studio_deliver_monitoring_timestamp: timestamp,
      x_studio_delivery_record: recordId,
      x_studio_field: change.field,
      x_studio_invoice_number:
        record.x_studio_invoice_number || "",
      x_studio_old_value: change.oldValue,
      x_studio_new_value: change.newValue,
      x_studio_transaction_id: transactionId,
      x_studio_user: auditUser.userName,
      x_studio_user_role: auditUser.userRole
    };
  });

  try {
    odooCreateAuditLogs_(connection, auditRows);

  } catch (auditError) {
    try {
      const rollbackResult = odooExecuteKw_(
        connection,
        "x_delivery_records",
        "write",
        [[recordId], rollbackValues]
      );

      if (rollbackResult !== true) {
        throw new Error("Odoo did not confirm rollback.");
      }

    } catch (rollbackError) {
      throw new Error(
        "Audit logging failed AND the original values could not " +
        "be restored. Please check Odoo record " + recordId +
        ". Audit error: " + auditError.message +
        ". Rollback error: " + rollbackError.message
      );
    }

    throw new Error(
      "Audit logging failed. The assignment update was rolled back. " +
      auditError.message
    );
  }

  return {
    success: true,
    message: "Assignment updated and audit logs created.",
    recordId: recordId,
    invoiceNumber: record.x_studio_invoice_number,
    transactionId: transactionId,
    changedFields: auditChanges.map(function(change) {
      return change.field;
    })
  };
}


/****************************************************
 * AUTOMATIC TRIP ID GENERATION
 ****************************************************/

/**
 * Generate the next daily sequential Trip ID.
 *
 * IMPORTANT:
 * This function assumes the caller already holds
 * the script lock.
 *
 * Example:
 * TRIP-20261109-001
 */
function generateDeliveryTripId_(connection) {
  const datePart = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyyMMdd"
  );

  const prefix = "TRIP-" + datePart + "-";

  const existingRecords = odooSearchReadAll_(
    connection,
    "x_delivery_records",
    [["x_studio_trip_id", "ilike", prefix]],
    ["id", "x_studio_trip_id"],
    "id asc"
  );

  let highestNumber = 0;

  existingRecords.forEach(function(record) {
    const tripId = String(record.x_studio_trip_id || "");

    if (tripId.indexOf(prefix) === 0) {
      const sequence = Number(
        tripId.substring(prefix.length)
      );

      if (
        Number.isInteger(sequence) &&
        sequence > highestNumber
      ) {
        highestNumber = sequence;
      }
    }
  });

  return prefix + String(highestNumber + 1).padStart(3, "0");
}


/****************************************************
 * CREATE DELIVERY TRIP - LOCKED ENTRY POINT
 ****************************************************/

/**
 * Public function called by Dashboard.html.
 *
 * Holds the script lock throughout trip creation,
 * including the Odoo update and audit logging.
 */
function createDeliveryTrip(
  token,
  recordIds,
  schedule,
  reason,
  scheduleType
) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      "Another trip is currently being created. Please try again."
    );
  }

  try {
    return createDeliveryTripLocked_(
      token,
      recordIds,
      schedule,
      reason,
      scheduleType
    );

  } finally {
    lock.releaseLock();
  }
}


/****************************************************
 * CREATE MULTI-INVOICE DELIVERY TRIP
 ****************************************************/

/**
 * Internal trip creation function.
 *
 * scheduleType:
 * - NEW_TRIP: PENDING invoices only
 * - ADD_SCHEDULE: WITH CONCERNS invoices only
 */


/****************************************************
 * CREATE MULTI-INVOICE DELIVERY TRIP
 ****************************************************/

function createDeliveryTripLocked_(
  token,
  recordIds,
  schedule,
  reason,
  scheduleType
) {

  // 1. USER AND PERMISSION VALIDATION

  const sessionUser = getSessionUser(token);

  if (!sessionUser) {
    throw new Error("Your session has expired. Please log in again.");
  }

  const role = String(sessionUser.role || "").trim().toUpperCase();

  if (!["ADMIN", "MANAGER", "ENCODER"].includes(role)) {
    throw new Error("You are not authorized to create delivery trips.");
  }

  if (!["NEW_TRIP", "ADD_SCHEDULE"].includes(scheduleType)) {
    throw new Error("Invalid trip action.");
  }


  // 2. SELECTED INVOICE VALIDATION

  if (!Array.isArray(recordIds) || !recordIds.length) {
    throw new Error("Please select at least one invoice.");
  }

  const ids = [...new Set(recordIds.map(Number))];

  if (ids.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new Error("One or more selected invoice IDs are invalid.");
  }


  // 3. TRIP DETAILS VALIDATION

  if (!schedule || typeof schedule !== "object") {
    throw new Error("Trip details are missing.");
  }

  reason = String(reason || "").trim();

  if (!reason) {
    throw new Error("Reason is required before creating the trip.");
  }

  if (reason.length > 2000) {
    throw new Error("Reason cannot exceed 2,000 characters.");
  }

  const deliveryDate = String(schedule.deliveryDate || "").trim();
  const truck = String(schedule.truck || "").trim();
  const driver = String(schedule.driver || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
    throw new Error("Please provide a valid delivery date.");
  }

  const parsedDate = new Date(deliveryDate + "T00:00:00Z");

  if (
    isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== deliveryDate
  ) {
    throw new Error("The delivery date is invalid.");
  }

  if (!truck || !driver) {
    throw new Error("Truck and Driver are required.");
  }

  // Each selected invoice must have its own area.
  if (
    !schedule.invoiceAreas ||
    typeof schedule.invoiceAreas !== "object" ||
    Array.isArray(schedule.invoiceAreas)
  ) {
    throw new Error("Individual invoice areas are missing.");
  }

  const invoiceAreas = {};

  ids.forEach(function(id) {
    const area = String(
      schedule.invoiceAreas[id] || ""
    ).trim();

    if (!area) {
      throw new Error(
        "Please provide an area for every selected invoice. " +
        "Missing area for Delivery Record ID " + id + "."
      );
    }

    invoiceAreas[id] = area;
  });

  if (
    !Array.isArray(schedule.helperIds) ||
    !schedule.helperIds.length
  ) {
    throw new Error("Please select at least one helper.");
  }


  // 4. CONNECT TO ODOO AND VALIDATE HELPERS

  const connection = odooGetConnection_();
  const helperMap = odooGetHelperMap_(connection);

  const activeHelpers = odooSearchReadAll_(
    connection,
    "x_delivery_helpers",
    [["x_active", "=", true]],
    ["id"],
    "id asc"
  );

  const activeHelperIds = new Set(
    activeHelpers.map(helper => Number(helper.id))
  );

  const helperIds = [...new Set(
    schedule.helperIds.map(Number)
  )];

  helperIds.forEach(function(id) {
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !helperMap[id] ||
      !activeHelperIds.has(id)
    ) {
      throw new Error("A selected helper is invalid or inactive.");
    }
  });


  // 5. RETRIEVE SELECTED ACTIVE INVOICES

  const records = odooSearchReadAll_(
    connection,
    "x_delivery_records",
    [
      ["id", "in", ids],
      ["x_active", "=", true]
    ],
    [
      "id",
      "x_studio_invoice_number",
      "x_studio_status",
      "x_studio_delivery_date",
      "x_studio_area",
      "x_studio_truck",
      "x_studio_driver",
      "x_studio_helper_1",
      "x_studio_trip_id"
    ],
    "id asc"
  );

  if (records.length !== ids.length) {
    throw new Error(
      "Some selected invoices could not be found or are inactive. " +
      "Refresh the dashboard and try again."
    );
  }


  // 6. VALIDATE INVOICE STATUSES

  const concernStatuses = [
    "DELIVERED - WITH CANCELLED ITEM(S)",
    "DELIVERED - WITH INVOICE CONCERN",
    "DELIVERED - WITH ITEM(S) TO FOLLOW",
    "DELIVERED - WITH COA TO FOLLOW",
    "DELIVERY ATTEMPT UNSUCCESSFUL (1)",
    // DELIVERY ATTEMPT UNSUCCESSFUL (2) is final and cannot be scheduled again.
    "BACKLOAD",
    "CANCELLED"
  ];

  records.forEach(function(record) {
    const status = String(
      record.x_studio_status || ""
    ).trim().toUpperCase();

    if (scheduleType === "ADD_SCHEDULE" && status === "DELIVERY ATTEMPT UNSUCCESSFUL (2)") {
      throw new Error(
        "Invoice " + (record.x_studio_invoice_number || record.id) +
        " has already had two unsuccessful delivery attempts. A third delivery attempt is not allowed."
      );
    }

    const eligible = scheduleType === "NEW_TRIP"
      ? status === "PENDING"
      : concernStatuses.includes(status);

    if (!eligible) {
      throw new Error(
        "Invoice " +
        (record.x_studio_invoice_number || record.id) +
        " cannot be included in this action. Current status: " +
        status + ". Refresh the dashboard and try again."
      );
    }
  });


  // 7. GENERATE TRIP AND TRANSACTION IDs

  const tripId = generateDeliveryTripId_(connection);
  const transactionId = Utilities.getUuid();
  const timestamp = odooGetAuditTimestamp_();
  const auditUser = odooGetAuditUser_(sessionUser, role);


  // 8. PREPARE SHARED TRIP DETAILS

  const sharedUpdateValues = {
    x_studio_delivery_date: deliveryDate,
    x_studio_truck: truck,
    x_studio_driver: driver,
    x_studio_helper_1: [[6, 0, helperIds]],
    x_studio_trip_id: tripId,
    x_studio_status: "SCHEDULED"
  };

  const auditRows = [];
  const rollbackValues = {};
  const updatedRecordIds = [];


  // 9. PREPARE INDIVIDUAL UPDATES AND AUDIT LOGS

  records.forEach(function(record) {

    const invoiceNumber =
      record.x_studio_invoice_number || record.x_name || "";

    const recordId = Number(record.id);

    const oldHelperIds = (
      record.x_studio_helper_1 || []
    ).map(Number);

    const oldHelperNames = odooGetHelperNames_(
      oldHelperIds,
      helperMap
    ).join(", ");

    const newHelperNames = odooGetHelperNames_(
      helperIds,
      helperMap
    ).join(", ");

    const oldValues = {
      "Delivery Date": record.x_studio_delivery_date || "",
      "Area": record.x_studio_area || "",
      "Truck": record.x_studio_truck || "",
      "Driver": odooGetRelationName_(record.x_studio_driver),
      "Helper(s)": oldHelperNames,
      "Trip ID": record.x_studio_trip_id || "",
      "Status": record.x_studio_status || ""
    };

    const newValues = {
      "Delivery Date": deliveryDate,
      "Area": invoiceAreas[recordId],
      "Truck": truck,
      "Driver": driver,
      "Helper(s)": newHelperNames,
      "Trip ID": tripId,
      "Status": "SCHEDULED"
    };

    // Preserve every original value for rollback.
    rollbackValues[recordId] = {
      x_studio_delivery_date:
        record.x_studio_delivery_date || false,

      x_studio_area:
        record.x_studio_area || false,

      x_studio_truck:
        record.x_studio_truck || false,

      x_studio_driver:
        record.x_studio_driver || false,

      x_studio_helper_1: [
        [6, 0, oldHelperIds]
      ],

      x_studio_trip_id:
        record.x_studio_trip_id || false,

      x_studio_status:
        record.x_studio_status || false
    };

    // Only log fields that actually changed.
    Object.keys(newValues).forEach(function(field) {

      const oldValue = String(oldValues[field]);
      const newValue = String(newValues[field]);

      if (oldValue === newValue) return;

      auditRows.push({
        x_name: invoiceNumber + " - " + field,

        x_studio_action:
          field === "Status"
            ? "STATUS UPDATE"
            : "UPDATE",

        x_studio_change_justification: reason,

        x_studio_deliver_monitoring_timestamp: timestamp,

        x_studio_delivery_record: recordId,

        x_studio_field: field,

        x_studio_invoice_number: invoiceNumber,

        x_studio_old_value: oldValue,

        x_studio_new_value: newValue,

        x_studio_transaction_id: transactionId,

        x_studio_user: auditUser.userName,

        x_studio_user_role: auditUser.userRole
      });
    });
  });


  // 10. UPDATE RECORDS INDIVIDUALLY
  // Each invoice receives its own area.
  // Other trip details remain shared.

  try {

    records.forEach(function(record) {

      const recordId = Number(record.id);

      const updateValues = Object.assign(
        {},
        sharedUpdateValues,
        {
          x_studio_area: invoiceAreas[recordId]
        }
      );

      const result = odooExecuteKw_(
        connection,
        "x_delivery_records",
        "write",
        [[recordId], updateValues]
      );

      if (result !== true) {
        throw new Error(
          "Odoo could not update invoice " +
          (record.x_studio_invoice_number || recordId)
        );
      }

      updatedRecordIds.push(recordId);
    });

  } catch (updateError) {

    const rollbackErrors = [];

    updatedRecordIds.forEach(function(recordId) {
      try {
        const result = odooExecuteKw_(
          connection,
          "x_delivery_records",
          "write",
          [[recordId], rollbackValues[recordId]]
        );

        if (result !== true) {
          throw new Error("Odoo did not confirm rollback.");
        }

      } catch (rollbackError) {
        rollbackErrors.push(
          recordId + ": " + rollbackError.message
        );
      }
    });

    if (rollbackErrors.length) {
      throw new Error(
        "Trip update failed and some records could not be restored: " +
        rollbackErrors.join("; ") +
        ". Original error: " + updateError.message
      );
    }

    throw new Error(
      "Trip update failed. Changes were rolled back. " +
      updateError.message
    );
  }


  // 11. CREATE AUDIT LOGS

  try {

    odooCreateAuditLogs_(
      connection,
      auditRows
    );

  } catch (auditError) {

    const rollbackErrors = [];

    updatedRecordIds.forEach(function(recordId) {
      try {
        const result = odooExecuteKw_(
          connection,
          "x_delivery_records",
          "write",
          [[recordId], rollbackValues[recordId]]
        );

        if (result !== true) {
          throw new Error("Odoo did not confirm rollback.");
        }

      } catch (rollbackError) {
        rollbackErrors.push(
          recordId + ": " + rollbackError.message
        );
      }
    });

    if (rollbackErrors.length) {
      throw new Error(
        "Audit logging failed and some records could not be restored: " +
        rollbackErrors.join("; ") +
        ". Audit error: " + auditError.message
      );
    }

    throw new Error(
      "Audit logging failed. The trip changes were rolled back. " +
      auditError.message
    );
  }


  // 12. RETURN SUCCESS

  return {
    success: true,

    message: "Delivery trip created successfully.",

    tripId: tripId,

    transactionId: transactionId,

    invoiceCount: records.length,

    invoiceNumbers: records.map(function(record) {
      return record.x_studio_invoice_number || record.x_name || "";
    })
  };
}


/****************************************************
 * EDIT EXISTING DELIVERY TRIP
 ****************************************************/

/**
 * Update shared trip details and/or individual invoice areas.
 *
 * Shared fields:
 * - Delivery Date
 * - Truck
 * - Driver
 * - Helper(s)
 *
 * Individual field:
 * - Area
 *
 * Does NOT change:
 * - Trip ID
 * - Invoice status
 *
 * Every changed field is written to the existing
 * Odoo Delivery Audit Logs model.
 */
function updateDeliveryTrip(token, tripId, changes, reason) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      "Another delivery update is in progress. Please try again."
    );
  }

  try {
    const sessionUser = getSessionUser(token);

    if (!sessionUser) {
      throw new Error(
        "Your session has expired. Please log in again."
      );
    }

    const role = String(
      sessionUser.role || ""
    ).trim().toUpperCase();

    if (!["ADMIN", "MANAGER", "ENCODER"].includes(role)) {
      throw new Error(
        "You are not authorized to edit delivery trips."
      );
    }

    tripId = String(tripId || "").trim();

    if (!tripId) {
      throw new Error("Trip ID is required.");
    }

    if (!changes || typeof changes !== "object") {
      throw new Error("No trip changes were provided.");
    }

    reason = String(reason || "").trim();

    if (!reason) {
      throw new Error("Reason for Change is required.");
    }

    if (reason.length > 2000) {
      throw new Error("Reason cannot exceed 2,000 characters.");
    }

    const connection = odooGetConnection_();
    const helperMap = odooGetHelperMap_(connection);

    // Retrieve every active invoice belonging to this exact trip.
    const records = odooSearchReadAll_(
      connection,
      "x_delivery_records",
      [
        ["x_studio_trip_id", "=", tripId],
        ["x_active", "=", true]
      ],
      [
        "id",
        "x_studio_invoice_number",
        "x_name",
        "x_studio_delivery_date",
        "x_studio_area",
        "x_studio_truck",
        "x_studio_driver",
        "x_studio_helper_1",
        "x_studio_trip_id",
        "x_studio_status"
      ],
      "id asc"
    );

    if (!records.length) {
      throw new Error(
        "No active invoices were found for Trip ID " + tripId + "."
      );
    }

    // Validate supplied shared fields.
    const sharedFields = {};

    if (
      Object.prototype.hasOwnProperty.call(
        changes,
        "deliveryDate"
      )
    ) {
      const date = String(
        changes.deliveryDate || ""
      ).trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Please provide a valid delivery date.");
      }

      const parsed = new Date(date + "T00:00:00Z");

      if (
        isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date
      ) {
        throw new Error("The delivery date is invalid.");
      }

      sharedFields.x_studio_delivery_date = date;
    }

    if (Object.prototype.hasOwnProperty.call(changes, "truck")) {
      const truck = String(changes.truck || "").trim();

      if (!truck) {
        throw new Error("Truck is required.");
      }

      sharedFields.x_studio_truck = truck;
    }

    if (Object.prototype.hasOwnProperty.call(changes, "driver")) {
      const driver = String(changes.driver || "").trim();

      if (!driver) {
        throw new Error("Driver is required.");
      }

      sharedFields.x_studio_driver = driver;
    }

    let newHelperIds = null;

    if (
      Object.prototype.hasOwnProperty.call(
        changes,
        "helperIds"
      )
    ) {
      if (
        !Array.isArray(changes.helperIds) ||
        !changes.helperIds.length
      ) {
        throw new Error("Select at least one helper.");
      }

      const activeHelpers = odooSearchReadAll_(
        connection,
        "x_delivery_helpers",
        [["x_active", "=", true]],
        ["id"],
        "id asc"
      );

      const activeIds = new Set(
        activeHelpers.map(function(helper) {
          return Number(helper.id);
        })
      );

      newHelperIds = [
        ...new Set(changes.helperIds.map(Number))
      ];

      newHelperIds.forEach(function(id) {
        if (
          !Number.isInteger(id) ||
          id <= 0 ||
          !activeIds.has(id)
        ) {
          throw new Error(
            "A selected helper is invalid or inactive."
          );
        }
      });

      sharedFields.x_studio_helper_1 = [
        [6, 0, newHelperIds]
      ];
    }

    // Validate individual invoice areas.
    const invoiceAreas = changes.invoiceAreas || {};

    if (
      typeof invoiceAreas !== "object" ||
      Array.isArray(invoiceAreas)
    ) {
      throw new Error("Invalid individual invoice areas.");
    }

    const tripRecordMap = {};

    records.forEach(function(record) {
      tripRecordMap[String(record.id)] = record;
    });

    Object.keys(invoiceAreas).forEach(function(id) {
      if (!tripRecordMap[id]) {
        throw new Error(
          "An invoice area refers to a record outside this trip."
        );
      }

      if (!String(invoiceAreas[id] || "").trim()) {
        throw new Error(
          "Area cannot be blank for invoice " +
          (tripRecordMap[id].x_studio_invoice_number ||
            tripRecordMap[id].x_name ||
            id) + "."
        );
      }
    });

    const transactionId = Utilities.getUuid();
    const timestamp = odooGetAuditTimestamp_();
    const auditUser = odooGetAuditUser_(sessionUser, role);

    const auditRows = [];
    const updates = [];
    const updatedRecordIds = [];

    function addAudit(
      record,
      field,
      oldValue,
      newValue
    ) {
      if (String(oldValue ?? "") === String(newValue ?? "")) {
        return;
      }

      const invoiceNumber =
        record.x_studio_invoice_number ||
        record.x_name ||
        "";

      auditRows.push({
        x_name: invoiceNumber + " - " + field,
        x_studio_action: "UPDATE",
        x_studio_change_justification: reason,
        x_studio_deliver_monitoring_timestamp: timestamp,
        x_studio_delivery_record: Number(record.id),
        x_studio_field: field,
        x_studio_invoice_number: invoiceNumber,
        x_studio_old_value: String(oldValue ?? ""),
        x_studio_new_value: String(newValue ?? ""),
        x_studio_transaction_id: transactionId,
        x_studio_user: auditUser.userName,
        x_studio_user_role: auditUser.userRole
      });
    }

    records.forEach(function(record) {
      const recordId = Number(record.id);
      const updateValues = {};
      const rollbackValues = {};

      // Shared delivery date.
      if (
        Object.prototype.hasOwnProperty.call(
          sharedFields,
          "x_studio_delivery_date"
        )
      ) {
        const oldValue = record.x_studio_delivery_date || "";
        const newValue = sharedFields.x_studio_delivery_date;

        if (String(oldValue) !== String(newValue)) {
          updateValues.x_studio_delivery_date = newValue;
          rollbackValues.x_studio_delivery_date =
            record.x_studio_delivery_date || false;

          addAudit(
            record,
            "Delivery Date",
            oldValue,
            newValue
          );
        }
      }

      // Shared truck.
      if (
        Object.prototype.hasOwnProperty.call(
          sharedFields,
          "x_studio_truck"
        )
      ) {
        const oldValue = record.x_studio_truck || "";
        const newValue = sharedFields.x_studio_truck;

        if (String(oldValue) !== String(newValue)) {
          updateValues.x_studio_truck = newValue;
          rollbackValues.x_studio_truck =
            record.x_studio_truck || false;

          addAudit(record, "Truck", oldValue, newValue);
        }
      }

      // Shared driver.
      if (
        Object.prototype.hasOwnProperty.call(
          sharedFields,
          "x_studio_driver"
        )
      ) {
        const oldValue = odooGetRelationName_(
          record.x_studio_driver
        );

        const newValue = sharedFields.x_studio_driver;

        if (String(oldValue).trim() !== newValue) {
          updateValues.x_studio_driver = newValue;
          rollbackValues.x_studio_driver =
            record.x_studio_driver || false;

          addAudit(record, "Driver", oldValue, newValue);
        }
      }

      // Shared helpers.
      if (newHelperIds !== null) {
        const oldIds = (
          record.x_studio_helper_1 || []
        ).map(Number);

        const oldSorted = oldIds.slice().sort(
          function(a, b) { return a - b; }
        );

        const newSorted = newHelperIds.slice().sort(
          function(a, b) { return a - b; }
        );

        if (
          JSON.stringify(oldSorted) !==
          JSON.stringify(newSorted)
        ) {
          updateValues.x_studio_helper_1 = [
            [6, 0, newHelperIds]
          ];

          rollbackValues.x_studio_helper_1 = [
            [6, 0, oldIds]
          ];

          addAudit(
            record,
            "Helper(s)",
            odooGetHelperNames_(oldIds, helperMap).join(", "),
            odooGetHelperNames_(
              newHelperIds,
              helperMap
            ).join(", ")
          );
        }
      }

      // Individual area, only when supplied for this invoice.
      if (
        Object.prototype.hasOwnProperty.call(
          invoiceAreas,
          String(recordId)
        )
      ) {
        const oldValue = record.x_studio_area || "";
        const newValue = String(
          invoiceAreas[String(recordId)]
        ).trim();

        if (String(oldValue).trim() !== newValue) {
          updateValues.x_studio_area = newValue;
          rollbackValues.x_studio_area =
            record.x_studio_area || false;

          addAudit(record, "Area", oldValue, newValue);
        }
      }

      if (Object.keys(updateValues).length) {
        updates.push({
          id: recordId,
          values: updateValues,
          rollback: rollbackValues
        });
      }
    });

    if (!auditRows.length || !updates.length) {
      throw new Error("No changes were detected.");
    }

    // Apply each record update and keep rollback data.
    try {
      updates.forEach(function(item) {
        const result = odooExecuteKw_(
          connection,
          "x_delivery_records",
          "write",
          [[item.id], item.values]
        );

        if (result !== true) {
          throw new Error(
            "Odoo could not update Delivery Record " + item.id
          );
        }

        updatedRecordIds.push(item.id);
      });

      // Create audit logs only after all record writes succeed.
      odooCreateAuditLogs_(connection, auditRows);

    } catch (saveError) {
      const rollbackErrors = [];

      updates.forEach(function(item) {
        if (!updatedRecordIds.includes(item.id)) return;

        try {
          const result = odooExecuteKw_(
            connection,
            "x_delivery_records",
            "write",
            [[item.id], item.rollback]
          );

          if (result !== true) {
            throw new Error("Odoo did not confirm rollback.");
          }

        } catch (rollbackError) {
          rollbackErrors.push(
            item.id + ": " + rollbackError.message
          );
        }
      });

      if (rollbackErrors.length) {
        throw new Error(
          "Trip update or audit logging failed. Some records " +
          "could not be restored: " +
          rollbackErrors.join("; ") +
          ". Original error: " + saveError.message
        );
      }

      throw new Error(
        "Trip update was not completed. Changes were rolled back. " +
        saveError.message
      );
    }

    return {
      success: true,
      message: "Trip updated and audit logs created.",
      tripId: tripId,
      transactionId: transactionId,
      invoiceCount: records.length,
      updatedInvoiceCount: updates.length,
      changedFields: [...new Set(
        auditRows.map(function(row) {
          return row.x_studio_field;
        })
      )]
    };

  } finally {
    lock.releaseLock();
  }
}


function inspectHelperDeliveryFields() {
  const connection = odooGetConnection_();

  const models = [
    "x_delivery_records",
    "x_delivery_photos"
  ];

  const attributes = [
    "string",
    "type",
    "selection",
    "relation",
    "required",
    "readonly"
  ];

  models.forEach(function(model) {
    Logger.log("====================================");
    Logger.log("MODEL: " + model);
    Logger.log("====================================");

    const fields = odooExecuteKw_(
      connection,
      model,
      "fields_get",
      [[], attributes]
    );

    Object.keys(fields).sort().forEach(function(fieldName) {
      const field = fields[fieldName];

      Logger.log(JSON.stringify({
        fieldName: fieldName,
        label: field.string,
        type: field.type,
        selection: field.selection || null,
        relation: field.relation || null,
        required: field.required,
        readonly: field.readonly
      }));
    });
  });

  Logger.log("===== FIELD INSPECTION COMPLETE =====");
}

/****************************************************
 * DELIVERY STATUS CORRECTION
 ****************************************************/

/**
 * Correct a status through the permitted correction paths.
 * Corrections always require a reason and are written to Odoo audit logs.
 *
 * Supported corrections:
 * - READY FOR DELIVERY -> SCHEDULED
 * - IN TRANSIT -> DEPARTED
 * - DELIVERED SUCCESSFULLY -> DEPARTED only while another invoice
 *   in the same trip is IN TRANSIT
 * - One delivery-result status -> another delivery-result status
 *
 * When correcting a delivery-result status, the delivery remarks are
 * updated in x_studio_delivery_remarks and audited as a separate field.
 */
function updateDeliveryStatus(token, recordId, newStatus, reason, deliveryRemarks) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error("Another status update is being processed. Please try again.");
  }

  let connection;
  let originalValues = null;
  let writeCompleted = false;

  try {
    const sessionUser = getSessionUser(token);

    if (!sessionUser) {
      throw new Error("Your session has expired. Please log in again.");
    }

    const role = String(sessionUser.role || "").trim().toUpperCase();

    if (!["ADMIN", "MANAGER", "ENCODER", "HELPER"].includes(role)) {
      throw new Error("You are not authorized to correct delivery status.");
    }

    recordId = Number(recordId);
    if (!Number.isInteger(recordId) || recordId <= 0) {
      throw new Error("Invalid Delivery Record ID.");
    }

    newStatus = String(newStatus || "").trim().toUpperCase();
    reason = String(reason || "").trim();
    deliveryRemarks = String(deliveryRemarks || "").trim();

    if (!reason) {
      throw new Error("Reason / Justification is required.");
    }
    if (reason.length > 2000) {
      throw new Error("Reason cannot exceed 2,000 characters.");
    }
    if (deliveryRemarks.length > 4000) {
      throw new Error("Delivery remarks cannot exceed 4,000 characters.");
    }

    const resultStatuses = [
      "DELIVERED SUCCESSFULLY",
      "DELIVERED - WITH CANCELLED ITEM(S)",
      "DELIVERED - WITH INVOICE CONCERN",
      "DELIVERED - WITH ITEM(S) TO FOLLOW",
      "DELIVERED - WITH COA TO FOLLOW",
      "DELIVERY ATTEMPT UNSUCCESSFUL (1)",
      "DELIVERY ATTEMPT UNSUCCESSFUL (2)",
      "BACKLOAD",
      "CANCELLED"
    ];

    connection = odooGetConnection_();

    const records = odooSearchReadAll_(
      connection,
      "x_delivery_records",
      [["id", "=", recordId], ["x_active", "=", true]],
      [
        "id",
        "x_studio_invoice_number",
        "x_studio_status",
        "x_studio_status_timestamp",
        "x_studio_departed",
        "x_studio_in_transit",
        "x_studio_arrived",
        "x_studio_delivery_remarks",
        "x_studio_return_to_area_today",
        "x_studio_trip_id",
        "x_studio_driver",
        "x_studio_helper_1"
      ],
      "id asc"
    );

    if (!records.length) {
      throw new Error("Delivery Record not found or inactive.");
    }

    const record = records[0];
    const oldStatus = String(record.x_studio_status || "").trim().toUpperCase();
    const tripId = String(record.x_studio_trip_id || "").trim();
    const oldRemarks = String(record.x_studio_delivery_remarks || "");

    // The second unsuccessful attempt is the final delivery attempt.
    // Do not allow a status correction to reopen it for another schedule.
    if (oldStatus === "DELIVERY ATTEMPT UNSUCCESSFUL (2)" &&
        newStatus !== oldStatus) {
      throw new Error(
        "This invoice has already had two unsuccessful delivery attempts. Its status is final and cannot be changed to allow another delivery."
      );
    }

    const allStatuses = [
      "PENDING",
      "SCHEDULED",
      "READY FOR DELIVERY",
      "DEPARTED",
      "IN TRANSIT",
      "ARRIVED",
      "DELIVERED SUCCESSFULLY",
      "DELIVERED - WITH CANCELLED ITEM(S)",
      "DELIVERED - WITH INVOICE CONCERN",
      "DELIVERED - WITH ITEM(S) TO FOLLOW",
      "DELIVERED - WITH COA TO FOLLOW",
      "DELIVERY ATTEMPT UNSUCCESSFUL (1)",
      "DELIVERY ATTEMPT UNSUCCESSFUL (2)",
      "BACKLOAD",
      "CANCELLED"
    ];

    let correctionAllowed = false;

    // Encoder can correct an invoice to any valid delivery status.
    if (role === "ENCODER") {
      correctionAllowed = allStatuses.includes(newStatus);
    } else if (role === "HELPER") {
      // Helper Edit Status is limited to movement corrections.
      // Delivery results are submitted through UPDATE STATUS after ARRIVED.
      if (oldStatus === "IN TRANSIT" && newStatus === "DEPARTED") {
        correctionAllowed = true;
      } else if (
        oldStatus === "ARRIVED" &&
        ["DEPARTED", "IN TRANSIT"].includes(newStatus)
      ) {
        correctionAllowed = true;
      }
    } else if (oldStatus === "READY FOR DELIVERY" && newStatus === "SCHEDULED") {
      correctionAllowed = true;
    } else if (oldStatus === "IN TRANSIT" && newStatus === "DEPARTED") {
      correctionAllowed = true;
    } else if (
      oldStatus === "DELIVERED SUCCESSFULLY" &&
      newStatus === "DEPARTED"
    ) {
      if (!tripId) {
        throw new Error("This invoice has no Trip ID, so this correction is unavailable.");
      }

      const tripRecords = odooSearchReadAll_(
        connection,
        "x_delivery_records",
        [
          ["x_studio_trip_id", "=", tripId],
          ["x_active", "=", true]
        ],
        ["id", "x_studio_status"],
        "id asc"
      );

      const anotherInvoiceInTransit = tripRecords.some(function(item) {
        return Number(item.id) !== recordId &&
          String(item.x_studio_status || "").trim().toUpperCase() === "IN TRANSIT";
      });

      if (!anotherInvoiceInTransit) {
        throw new Error(
          "DEPARTED is available for this delivered invoice only while another invoice in the same trip is IN TRANSIT."
        );
      }

      correctionAllowed = true;
    } else if (
      role !== "HELPER" &&
      ((oldStatus === "ARRIVED" && resultStatuses.includes(newStatus)) ||
       (resultStatuses.includes(oldStatus) &&
        resultStatuses.includes(newStatus) && oldStatus !== newStatus))
    ) {
      // Admin/Manager may continue using the existing result correction path.
      correctionAllowed = true;
    }

    // Encoder may set IN TRANSIT only on a DEPARTED invoice and only when
    // no other invoice in the same Trip ID is IN TRANSIT or ARRIVED.
    // This server-side check prevents stale dropdowns or direct calls from
    // bypassing the one-active-invoice-per-trip rule.
    if (role === "ENCODER" && newStatus === "IN TRANSIT") {
      if (oldStatus !== "DEPARTED") {
        throw new Error(
          "Only a DEPARTED invoice can be changed to IN TRANSIT. First change the currently active invoice to DEPARTED."
        );
      }

      if (!tripId) {
        throw new Error(
          "This invoice has no Trip ID. IN TRANSIT cannot be assigned without a Trip ID."
        );
      }

      const tripRecords = odooSearchReadAll_(
        connection,
        "x_delivery_records",
        [
          ["x_studio_trip_id", "=", tripId],
          ["x_active", "=", true]
        ],
        ["id", "x_studio_status", "x_studio_trip_id"],
        "id asc"
      );

      const anotherActiveInvoice = tripRecords.find(function(item) {
        const itemStatus = String(item.x_studio_status || "")
          .trim().toUpperCase();
        return Number(item.id) !== recordId &&
          ["IN TRANSIT", "ARRIVED"].includes(itemStatus);
      });

      if (anotherActiveInvoice) {
        const activeStatus = String(anotherActiveInvoice.x_studio_status || "")
          .trim().toUpperCase();
        throw new Error(
          "IN TRANSIT is unavailable because another invoice in this trip is " +
          activeStatus + ". Change that invoice to DEPARTED first, then try again."
        );
      }
    }

    if (!correctionAllowed) {
      throw new Error(
        "This status correction is not permitted from " +
        (oldStatus || "the current status") + " to " + (newStatus || "the selected status") + "."
      );
    }

    if (resultStatuses.includes(newStatus) && !deliveryRemarks) {
      throw new Error("Delivery remarks are required when correcting a delivery result.");
    }

    if (role === "HELPER") {
      const helperMap = odooGetHelperMap_(connection);
      const assignedHelpers = odooGetHelperNames_(
        record.x_studio_helper_1 || [],
        helperMap
      );
      const fullName = String(sessionUser.fullName || "").trim().toLowerCase();
      const driverName = String(record.x_studio_driver || "").trim().toLowerCase();

      const helperMatch = assignedHelpers.some(function(name) {
        return String(name || "").trim().toLowerCase() === fullName;
      });

      if (!fullName || (!helperMatch && driverName !== fullName)) {
        throw new Error("You can only correct invoices assigned to your account.");
      }
    }

    if (oldStatus === newStatus && oldRemarks === deliveryRemarks) {
      throw new Error("No changes were detected.");
    }

    const auditUser = odooGetAuditUser_(sessionUser, role);
    const transactionId = Utilities.getUuid();
    const timestamp = odooGetAuditTimestamp_();

    originalValues = {
      status: oldStatus,
      timestamp: record.x_studio_status_timestamp || false,
      departed: record.x_studio_departed || false,
      inTransit: record.x_studio_in_transit || false,
      arrived: record.x_studio_arrived || false,
      remarks: oldRemarks,
      returnToAreaToday: record.x_studio_return_to_area_today === true
    };

    const valuesToWrite = {
      x_studio_status: newStatus,
      x_studio_status_timestamp: timestamp
    };

    // Update only the movement timestamp matching the newly selected status.
    // The other movement timestamps remain unchanged.
    const movementTimestampField = odooGetMovementTimestampField_(newStatus);
    if (movementTimestampField) {
      valuesToWrite[movementTimestampField] = timestamp;
    }

    if (resultStatuses.includes(newStatus)) {
      valuesToWrite.x_studio_delivery_remarks = deliveryRemarks;
    }
    // A manually corrected status must not retain a previous same-day retry decision.
    valuesToWrite.x_studio_return_to_area_today = false;

    const writeResult = odooExecuteKw_(
      connection,
      "x_delivery_records",
      "write",
      [[recordId], valuesToWrite]
    );

    if (writeResult !== true) {
      throw new Error("Odoo could not save the status correction.");
    }

    writeCompleted = true;

    const invoice = record.x_studio_invoice_number || ("Record " + recordId);
    const auditRows = [{
      x_name: invoice + " - Delivery Status - " + transactionId,
      x_studio_action: "STATUS UPDATE",
      x_studio_change_justification: reason,
      x_studio_deliver_monitoring_timestamp: timestamp,
      x_studio_delivery_record: recordId,
      x_studio_field: "Delivery Status",
      x_studio_invoice_number: record.x_studio_invoice_number || "",
      x_studio_old_value: oldStatus,
      x_studio_new_value: newStatus,
      x_studio_transaction_id: transactionId,
      x_studio_user: auditUser.userName,
      x_studio_user_role: auditUser.userRole
    }];

    if (
      resultStatuses.includes(newStatus) &&
      oldRemarks !== deliveryRemarks
    ) {
      auditRows.push({
        x_name: invoice + " - Delivery Remarks - " + transactionId,
        x_studio_action: "UPDATE",
        x_studio_change_justification: reason,
        x_studio_deliver_monitoring_timestamp: timestamp,
        x_studio_delivery_record: recordId,
        x_studio_field: "Delivery Remarks",
        x_studio_invoice_number: record.x_studio_invoice_number || "",
        x_studio_old_value: oldRemarks,
        x_studio_new_value: deliveryRemarks,
        x_studio_transaction_id: transactionId,
        x_studio_user: auditUser.userName,
        x_studio_user_role: auditUser.userRole
      });
    }

    try {
      odooCreateAuditLogs_(connection, auditRows);
    } catch (auditError) {
      const rollbackValues = {
        x_studio_status: originalValues.status,
        x_studio_status_timestamp: originalValues.timestamp,
        x_studio_departed: originalValues.departed,
        x_studio_in_transit: originalValues.inTransit,
        x_studio_arrived: originalValues.arrived,
        x_studio_delivery_remarks: originalValues.remarks,
        x_studio_return_to_area_today: originalValues.returnToAreaToday
      };

      const rollback = odooExecuteKw_(
        connection,
        "x_delivery_records",
        "write",
        [[recordId], rollbackValues]
      );

      if (rollback !== true) {
        throw new Error(
          "Audit logging failed and the status/remarks rollback could not be confirmed. " +
          "Check Delivery Record " + recordId + ". Audit error: " + auditError.message
        );
      }

      writeCompleted = false;
      throw new Error(
        "Audit logging failed. The status correction was rolled back. " +
        auditError.message
      );
    }

    return {
      success: true,
      recordId: recordId,
      invoiceNumber: record.x_studio_invoice_number || "",
      oldStatus: oldStatus,
      newStatus: newStatus,
      deliveryRemarks: resultStatuses.includes(newStatus) ? deliveryRemarks : oldRemarks,
      transactionId: transactionId
    };

  } catch (error) {
    // If a failure occurred after the record write but before audit logging,
    // attempt to restore the original values.
    if (writeCompleted && originalValues && connection) {
      try {
        odooExecuteKw_(
          connection,
          "x_delivery_records",
          "write",
          [[recordId], {
            x_studio_status: originalValues.status,
            x_studio_status_timestamp: originalValues.timestamp,
            x_studio_departed: originalValues.departed,
            x_studio_in_transit: originalValues.inTransit,
            x_studio_arrived: originalValues.arrived,
            x_studio_delivery_remarks: originalValues.remarks
          }]
        );
      } catch (rollbackError) {
        throw new Error(
          error.message + " Also, rollback failed: " + rollbackError.message
        );
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}


/****************************************************
 * DELIVERY WORKFLOW ACTIONS
 * First-time workflow actions do not require a reason.
 * Delivery-result actions require delivery remarks.
 ****************************************************/
function performDeliveryWorkflowAction(
  token,
  action,
  recordId,
  tripId,
  deliveryRemarks,
  photos,
  returnToAreaToday,
  returnDecisionProvided
) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      "Another delivery workflow action is being processed. Please try again."
    );
  }

  let connection;
  const written = [];
  const createdPhotoIds = [];

  try {
    const user = getSessionUser(token);

    if (!user) {
      throw new Error("Your session has expired. Please log in again.");
    }

    const role = String(user.role || "").trim().toUpperCase();
    const fullName = String(user.fullName || "").trim();

    if (!["ADMIN", "MANAGER", "ENCODER", "HELPER"].includes(role)) {
      throw new Error("You are not authorized to update delivery workflow.");
    }

    // Encoders correct mistaken invoice statuses through updateDeliveryStatus()
    // and the Edit Status dialog. They do not execute operational workflow
    // actions or submit delivery results/photos.
  

    if (role === "HELPER" && !fullName) {
      throw new Error("Your account needs a FULL NAME.");
    }

    action = String(action || "").trim().toUpperCase();
    tripId = String(tripId || "").trim();
    deliveryRemarks = String(deliveryRemarks || "").trim();
    photos = Array.isArray(photos) ? photos : [];
    returnToAreaToday = returnToAreaToday === true;
    returnDecisionProvided = returnDecisionProvided === true;

    if (photos.length > 5) {
      throw new Error("You can attach up to 5 photos per delivery update.");
    }
    if (photos.length && action.indexOf("RESULT:") !== 0) {
      throw new Error("Photos can be attached when saving a delivery result.");
    }

    let totalPhotoBytes = 0;
    photos.forEach(function(photo) {
      const name = String(photo && photo.name || "").trim();
      const mimeType = String(photo && photo.mimeType || "").trim().toLowerCase();
      const data = String(photo && photo.data || "").trim();
      if (!name || !/^image\//.test(mimeType) || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
        throw new Error("One of the attached photos is invalid.");
      }
      const estimatedBytes = Math.floor(data.length * 3 / 4);
      if (estimatedBytes > 2 * 1024 * 1024) {
        throw new Error(name + " exceeds the 2 MB per-photo limit.");
      }
      totalPhotoBytes += estimatedBytes;
    });
    if (totalPhotoBytes > 8 * 1024 * 1024) {
      throw new Error("Combined photo size cannot exceed 8 MB.");
    }

    if (deliveryRemarks.length > 4000) {
      throw new Error("Delivery remarks cannot exceed 4,000 characters.");
    }

    const resultStatuses = [
      "DELIVERED SUCCESSFULLY",
      "DELIVERED - WITH CANCELLED ITEM(S)",
      "DELIVERED - WITH INVOICE CONCERN",
      "DELIVERED - WITH ITEM(S) TO FOLLOW",
      "DELIVERED - WITH COA TO FOLLOW",
      "DELIVERY ATTEMPT UNSUCCESSFUL (1)",
      "DELIVERY ATTEMPT UNSUCCESSFUL (2)",
      "BACKLOAD",
      "CANCELLED"
    ];

    const actionToStatus = {
      READY: "READY FOR DELIVERY",
      TRANSIT: "IN TRANSIT",
      ARRIVED: "ARRIVED"
    };

    let targetStatus = "";

    if (action.indexOf("RESULT:") === 0) {
      targetStatus = action.slice(7).trim();

      if (!resultStatuses.includes(targetStatus)) {
        throw new Error("Invalid delivery result.");
      }

      action = "RESULT";

      if (!deliveryRemarks) {
        throw new Error("Please enter delivery remarks before saving the result.");
      }

      const isFirstUnsuccessfulResult = targetStatus === "DELIVERY ATTEMPT UNSUCCESSFUL (1)";
      const isSecondUnsuccessfulResult = targetStatus === "DELIVERY ATTEMPT UNSUCCESSFUL (2)";

      if (isFirstUnsuccessfulResult && !returnDecisionProvided) {
        throw new Error("Please answer whether you will return to the area today.");
      }
      if (isSecondUnsuccessfulResult && (returnDecisionProvided || returnToAreaToday)) {
        throw new Error("A second unsuccessful delivery attempt is final. No same-day return or third attempt is allowed.");
      }
      if (!isFirstUnsuccessfulResult && !isSecondUnsuccessfulResult && returnToAreaToday) {
        throw new Error("The return-to-area option applies only to the first unsuccessful delivery attempt.");
      }
    } else if (action !== "DEPART" && action !== "RETURN_TO_AREA" && !actionToStatus[action]) {
      throw new Error("Unknown workflow action.");
    }

    connection = odooGetConnection_();

    const all = odooSearchReadAll_(
      connection,
      "x_delivery_records",
      [["x_active", "=", true]],
      [
        "id",
        "x_name",
        "x_studio_invoice_number",
        "x_studio_status",
        "x_studio_status_timestamp",
        "x_studio_departed",
        "x_studio_in_transit",
        "x_studio_arrived",
        "x_studio_delivery_remarks",
        "x_studio_return_to_area_today",
        "x_studio_trip_id",
        "x_studio_driver",
        "x_studio_helper_1"
      ],
      "id asc"
    );

    let targets = [];

    if (action === "DEPART") {
      if (!["ADMIN", "MANAGER", "ENCODER"].includes(role)) {
        throw new Error("Only Admin, Manager, or Encoder can depart a trip.");
      }

      if (!tripId) {
        throw new Error("Trip ID is required.");
      }

      targets = all.filter(function(record) {
        return String(record.x_studio_trip_id || "").trim() === tripId;
      });

      if (!targets.length) {
        throw new Error("No active invoices were found for this trip.");
      }

      const notReady = targets.filter(function(record) {
        return String(record.x_studio_status || "").trim().toUpperCase() !==
          "READY FOR DELIVERY";
      });

      if (notReady.length) {
        throw new Error(
          "DEPART is available only when every invoice in the trip is READY FOR DELIVERY. " +
          notReady.length + " invoice(s) are not ready."
        );
      }

      targetStatus = "DEPARTED";

    } else {
      recordId = Number(recordId);

      if (!Number.isInteger(recordId) || recordId <= 0) {
        throw new Error("Invalid Delivery Record ID.");
      }

      targets = all.filter(function(record) {
        return Number(record.id) === recordId;
      });

      if (!targets.length) {
        throw new Error("The delivery record was not found or is inactive.");
      }

      const record = targets[0];
      tripId = String(record.x_studio_trip_id || "").trim();
      const oldStatus = String(record.x_studio_status || "").trim().toUpperCase();

      if (role === "HELPER") {
        const helperMap = odooGetHelperMap_(connection);
        const helperNames = odooGetHelperNames_(
          record.x_studio_helper_1 || [],
          helperMap
        );
        const me = fullName.toLowerCase();
        const driver = String(
          odooGetRelationName_(record.x_studio_driver) || ""
        ).trim().toLowerCase();

        if (
          driver !== me &&
          !helperNames.some(function(name) {
            return String(name || "").trim().toLowerCase() === me;
          })
        ) {
          throw new Error(
            "You can update only invoices assigned to you as Driver or Helper."
          );
        }
      }

      if (action === "READY" && oldStatus !== "SCHEDULED") {
        throw new Error(
          "Only SCHEDULED invoices can be marked READY FOR DELIVERY."
        );
      }

      if (action === "RETURN_TO_AREA") {
        if (role !== "HELPER") {
          throw new Error("Only the assigned Helper or Driver can return to the area.");
        }
        if (oldStatus !== "DELIVERY ATTEMPT UNSUCCESSFUL (1)") {
          throw new Error("RETURN TO AREA is available only after the first unsuccessful delivery attempt.");
        }
        if (record.x_studio_return_to_area_today !== true) {
          throw new Error("This invoice was not marked for another delivery attempt today.");
        }
        targetStatus = "DEPARTED";
      }

      if (action === "TRANSIT") {
        if (oldStatus !== "DEPARTED") {
          throw new Error(
            "An invoice can enter IN TRANSIT only after its trip has DEPARTED."
          );
        }

        if (!tripId) {
          throw new Error("This invoice has no Trip ID.");
        }

        const unfinishedStop = all.find(function(other) {
          const otherStatus = String(other.x_studio_status || "")
            .trim().toUpperCase();
          return Number(other.id) !== recordId &&
            String(other.x_studio_trip_id || "").trim() === tripId &&
            ["IN TRANSIT", "ARRIVED"].includes(otherStatus);
        });

        if (unfinishedStop) {
          const unfinishedStatus = String(unfinishedStop.x_studio_status || "")
            .trim().toUpperCase();
          throw new Error(
            unfinishedStatus === "ARRIVED"
              ? "Another invoice in this trip has ARRIVED but its delivery result has not been saved yet. Save its delivery result before moving to the next invoice."
              : "Another invoice in this trip is still IN TRANSIT. Mark it ARRIVED and save its delivery result before moving to the next invoice."
          );
        }
      }

      if (action === "ARRIVED" && oldStatus !== "IN TRANSIT") {
        throw new Error(
          "Only an invoice currently IN TRANSIT can be marked ARRIVED."
        );
      }

      if (action === "RESULT" && oldStatus !== "ARRIVED") {
        throw new Error(
          "Delivery results can be recorded only after the invoice is ARRIVED."
        );
      }

      if (action !== "RESULT" && action !== "RETURN_TO_AREA") {
        targetStatus = actionToStatus[action];
      }
    }

    const timestamp = odooGetAuditTimestamp_();
    const auditUser = odooGetAuditUser_(user, role);
    const transactionId = Utilities.getUuid();
    const auditRows = [];
    const changed = [];

    targets.forEach(function(record) {
      const oldStatus = String(record.x_studio_status || "").trim().toUpperCase();
      const oldRemarks = String(record.x_studio_delivery_remarks || "");

      if (oldStatus === targetStatus &&
          (action !== "RESULT" || oldRemarks === deliveryRemarks)) {
        return;
      }

      const valuesToWrite = {
        x_studio_status: targetStatus,
        x_studio_status_timestamp: timestamp
      };

      // Set the matching movement timestamp for DEPARTED, IN TRANSIT,
      // or ARRIVED. This also covers bulk DEPART actions for an entire trip.
      const movementTimestampField = odooGetMovementTimestampField_(targetStatus);
      if (movementTimestampField) {
        valuesToWrite[movementTimestampField] = timestamp;
      }

      if (action === "RESULT") {
        valuesToWrite.x_studio_delivery_remarks = deliveryRemarks;
        if (targetStatus.indexOf("DELIVERY ATTEMPT UNSUCCESSFUL") === 0) {
          valuesToWrite.x_studio_return_to_area_today = returnToAreaToday;
        } else {
          valuesToWrite.x_studio_return_to_area_today = false;
        }
      }
      if (action === "RETURN_TO_AREA") {
        valuesToWrite.x_studio_return_to_area_today = false;
      }

      const writeResult = odooExecuteKw_(
        connection,
        "x_delivery_records",
        "write",
        [[Number(record.id)], valuesToWrite]
      );

      if (writeResult !== true) {
        throw new Error(
          "Odoo did not confirm status update for record " + record.id
        );
      }

      written.push({
        id: Number(record.id),
        oldStatus: oldStatus,
        oldTimestamp: record.x_studio_status_timestamp || false,
        oldDeparted: record.x_studio_departed || false,
        oldInTransit: record.x_studio_in_transit || false,
        oldArrived: record.x_studio_arrived || false,
        oldRemarks: oldRemarks,
        oldReturnToAreaToday: record.x_studio_return_to_area_today === true
      });

      changed.push(Number(record.id));

      const invoice = String(
        record.x_studio_invoice_number || record.x_name || record.id
      );

      // First-time workflow actions intentionally have a blank justification.
      auditRows.push({
        x_name: "STATUS UPDATE - " + invoice + " - " + transactionId,
        x_studio_action: "STATUS UPDATE",
        x_studio_change_justification: "",
        x_studio_deliver_monitoring_timestamp: timestamp,
        x_studio_delivery_record: Number(record.id),
        x_studio_field: "Status",
        x_studio_invoice_number: invoice,
        x_studio_old_value: oldStatus,
        x_studio_new_value: targetStatus,
        x_studio_transaction_id: transactionId,
        x_studio_user: auditUser.userName,
        x_studio_user_role: auditUser.userRole
      });

      if (action === "RESULT" && targetStatus === "DELIVERY ATTEMPT UNSUCCESSFUL (1)") {
        auditRows.push({
          x_name: "RETURN TO AREA DECISION - " + invoice + " - " + transactionId,
          x_studio_action: "UPDATE",
          x_studio_change_justification: "",
          x_studio_deliver_monitoring_timestamp: timestamp,
          x_studio_delivery_record: Number(record.id),
          x_studio_field: "Return to Area Today?",
          x_studio_invoice_number: invoice,
          x_studio_old_value: record.x_studio_return_to_area_today === true ? "YES" : "NO",
          x_studio_new_value: returnToAreaToday ? "YES" : "NO",
          x_studio_transaction_id: transactionId,
          x_studio_user: auditUser.userName,
          x_studio_user_role: auditUser.userRole
        });
      } else if (action === "RETURN_TO_AREA") {
        auditRows.push({
          x_name: "RETURN TO AREA - " + invoice + " - " + transactionId,
          x_studio_action: "STATUS UPDATE",
          x_studio_change_justification: "",
          x_studio_deliver_monitoring_timestamp: timestamp,
          x_studio_delivery_record: Number(record.id),
          x_studio_field: "Return to Area Today?",
          x_studio_invoice_number: invoice,
          x_studio_old_value: "YES",
          x_studio_new_value: "RETURNING TO AREA",
          x_studio_transaction_id: transactionId,
          x_studio_user: auditUser.userName,
          x_studio_user_role: auditUser.userRole
        });
      }

      if (action === "RESULT" && oldRemarks !== deliveryRemarks) {
        auditRows.push({
          x_name: "DELIVERY REMARKS - " + invoice + " - " + transactionId,
          x_studio_action: "UPDATE",
          x_studio_change_justification: "",
          x_studio_deliver_monitoring_timestamp: timestamp,
          x_studio_delivery_record: Number(record.id),
          x_studio_field: "Delivery Remarks",
          x_studio_invoice_number: invoice,
          x_studio_old_value: oldRemarks,
          x_studio_new_value: deliveryRemarks,
          x_studio_transaction_id: transactionId,
          x_studio_user: auditUser.userName,
          x_studio_user_role: auditUser.userRole
        });
      }
    });

    if (!changed.length) {
      throw new Error("No status changes were needed.");
    }

    // Save delivery photos under the existing x_delivery_photos model.
    // The photo records are linked to the invoice Delivery Record.
    if (action === "RESULT" && photos.length) {
      const targetRecord = targets[0];
      const invoice = String(
        targetRecord.x_studio_invoice_number || targetRecord.x_name || targetRecord.id
      );
      const photoRows = photos.map(function(photo) {
        const cleanName = String(photo.name || "Delivery Photo")
          .replace(/[\\/:*?"<>|]/g, "_")
          .substring(0, 180);
        return {
          x_name: cleanName,
          x_studio_photo_name: cleanName,
          x_studio_delivery_record: Number(targetRecord.id),
          x_studio_delivery_image: String(photo.data)
        };
      });

      const photoResult = odooExecuteKw_(
        connection,
        "x_delivery_photos",
        "create",
        [photoRows]
      );
      const ids = Array.isArray(photoResult) ? photoResult : [photoResult];
      ids.forEach(function(id) {
        if (Number.isInteger(Number(id)) && Number(id) > 0) {
          createdPhotoIds.push(Number(id));
        }
      });
      if (createdPhotoIds.length !== photos.length) {
        throw new Error("Odoo did not confirm creation of every delivery photo.");
      }

      photos.forEach(function(photo) {
        const cleanName = String(photo.name || "Delivery Photo").substring(0, 180);
        auditRows.push({
          x_name: "PHOTO UPLOAD - " + invoice + " - " + transactionId,
          x_studio_action: "PHOTO UPLOAD",
          x_studio_change_justification: "",
          x_studio_deliver_monitoring_timestamp: timestamp,
          x_studio_delivery_record: Number(targetRecord.id),
          x_studio_field: "Delivery Photo",
          x_studio_invoice_number: invoice,
          x_studio_old_value: "",
          x_studio_new_value: cleanName,
          x_studio_transaction_id: transactionId,
          x_studio_user: auditUser.userName,
          x_studio_user_role: auditUser.userRole
        });
      });
    }

    try {
      odooCreateAuditLogs_(connection, auditRows);
    } catch (auditError) {
      const rollbackErrors = [];

      written.slice().reverse().forEach(function(item) {
        try {
          const rollbackResult = odooExecuteKw_(
            connection,
            "x_delivery_records",
            "write",
            [[item.id], {
              x_studio_status: item.oldStatus,
              x_studio_status_timestamp: item.oldTimestamp,
              x_studio_departed: item.oldDeparted,
              x_studio_in_transit: item.oldInTransit,
              x_studio_arrived: item.oldArrived,
              x_studio_delivery_remarks: item.oldRemarks,
              x_studio_return_to_area_today: item.oldReturnToAreaToday
            }]
          );

          if (rollbackResult !== true) {
            rollbackErrors.push(item.id + ": Odoo did not confirm rollback.");
          }
        } catch (rollbackError) {
          rollbackErrors.push(item.id + ": " + rollbackError.message);
        }
      });

      if (createdPhotoIds.length) {
        try {
          odooExecuteKw_(connection, "x_delivery_photos", "unlink", [createdPhotoIds]);
          createdPhotoIds.length = 0;
        } catch (photoRollbackError) {
          rollbackErrors.push("Photo rollback: " + photoRollbackError.message);
        }
      }

      if (rollbackErrors.length) {
        throw new Error(
          "Audit logging failed and rollback had errors: " +
          rollbackErrors.join("; ") + ". Audit error: " + auditError.message
        );
      }

      throw new Error(
        "Audit logging failed. The workflow update was rolled back. " +
        auditError.message
      );
    }

    return {
      success: true,
      action: action,
      newStatus: targetStatus,
      tripId: tripId,
      updatedCount: changed.length,
      uploadedPhotoCount: createdPhotoIds.length,
      message: changed.length +
        " invoice(s) updated, " + createdPhotoIds.length +
        " photo(s) uploaded, and audit logs created."
    };

  } catch (error) {
    // Restore any records written before a later Odoo write failed.
    if ((written.length || createdPhotoIds.length) && connection) {
      const rollbackErrors = [];

      written.slice().reverse().forEach(function(item) {
        try {
          const result = odooExecuteKw_(
            connection,
            "x_delivery_records",
            "write",
            [[item.id], {
              x_studio_status: item.oldStatus,
              x_studio_status_timestamp: item.oldTimestamp,
              x_studio_departed: item.oldDeparted,
              x_studio_in_transit: item.oldInTransit,
              x_studio_arrived: item.oldArrived,
              x_studio_delivery_remarks: item.oldRemarks,
              x_studio_return_to_area_today: item.oldReturnToAreaToday
            }]
          );

          if (result !== true) {
            rollbackErrors.push(item.id + ": Odoo did not confirm rollback.");
          }
        } catch (rollbackError) {
          rollbackErrors.push(item.id + ": " + rollbackError.message);
        }
      });

      if (createdPhotoIds.length) {
        try {
          odooExecuteKw_(connection, "x_delivery_photos", "unlink", [createdPhotoIds]);
          createdPhotoIds.length = 0;
        } catch (photoRollbackError) {
          rollbackErrors.push("Photo rollback: " + photoRollbackError.message);
        }
      }

      if (rollbackErrors.length) {
        throw new Error(
          error.message + " Rollback issues: " + rollbackErrors.join("; ")
        );
      }
    }

    throw error;

  } finally {
    lock.releaseLock();
  }
}



function inspectSalesAuditRoleField() {
  const connection = odooGetConnection_();

  const result = odooExecuteKw_(
    connection,
    "x_delivery_audit_logs",
    "fields_get",
    [],
    {
      attributes: ["string", "type", "selection", "required"]
    }
  );

  Logger.log(
    JSON.stringify(result.x_studio_user_role, null, 2)
  );
}
