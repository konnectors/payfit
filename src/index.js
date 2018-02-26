const {BaseKonnector, saveFiles, requestFactory} = require('cozy-konnector-libs')

const request = requestFactory({
  // debug: true,
  json: true,
  jar: true
})

const formatDate = require('date-fns/format')

module.exports = new BaseKonnector(start)

let idToken = ''

function start (fields) {
  return logIn(fields)
    .then(fetchPayrolls)
    .then(convertPayrollsToCozy)
    .then(documents => saveFiles(documents, fields))
}

function logIn (fields) {
  return request({
    uri: 'https://auth.payfit.com/signin',
    method: 'POST',
    body: {
      email: fields.username,
      password: fields.password,
      username: fields.username,
      language: 'fr'
    }
  }).then(body => {
    let id = body.accounts[0].id
    let tokens = id.split('/')
    let companyId = tokens[0]
    let employeeId = tokens[1]
    idToken = body.idToken

    return request({
      uri: 'https://auth.payfit.com/updateCurrentCompany?application=hr-apps/user&companyId=' +
        companyId +
        '&customApp=false&employeeId=' +
        employeeId +
        '&holdingId&idToken=' +
        idToken +
        '&origin=https://app.payfit.com'
    })
  })
}

function fetchPayrolls () {
  return request({
    method: 'POST',
    uri: 'https://api.payfit.com/api/employees/payrolls',
    headers: {
      'Authorization': idToken
    }
  })
}

function convertPayrollsToCozy (payrolls) {
  const baseUrl = 'https://api.payfit.com/api'

  return payrolls.map(function (payroll) {
    const url = baseUrl + payroll.url + '?' + idToken
    const date = getDateFromAbsoluteMonth(payroll.absoluteMonth)
    const filename = `${formatDate(date, 'YYYY_MM')}.pdf`
    return {
      fileurl: url,
      filename,
      requestOptions: {
        headers: {
          'Authorization': idToken
        }
      }
    }
  })
}

// module.exports = new BaseKonnector(requiredFields => {
//     // Retrieve payrolls
//   }).then(entries => saveFiles(entries, requiredFields.folderPath))
//     .catch(err => {
//       // Connector is not in error if there is not entry in the end
//       // It may be simply an empty account
//       if (err.message === 'NO_ENTRY') return []
//       throw err
//     })
// })

// extracted from Payfit front code
function getDateFromAbsoluteMonth (absoluteMonth) {
  return new Date(2015, absoluteMonth - 1)
}
