// Force sentry DSN into environment variables
// In the future, will be set by the stack
process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://bb9b62dfb62d4492959a88240d402b21:cac5cbbc6b474095a4754ad2a5f1bf72@sentry.cozycloud.cc/80'

const {
  BaseKonnector,
  log,
  saveBills,
  requestFactory,
  errors
} = require('cozy-konnector-libs')

const request = requestFactory({
  // debug: true,
  json: true,
  jar: true
})

const formatDate = require('date-fns/format')
const moment = require('moment')

module.exports = new BaseKonnector(start)

async function start(fields) {
  const tokens = await getTokens(fields)
  const payrolls = await fetchPayrolls(tokens)
  const { companyName } = await fetchProfileInfo()
  const documents = convertPayrollsToCozy(tokens, payrolls)

  moment.locale('fr')

  return saveBills(documents, fields, {
    sourceAccount: this.accountId,
    sourceAccountIdentifier: fields.login,
    linkBankOperations: false,
    fileIdAttributes: ['vendorId'],
    processPdf: (entry, text) => {
      const matchedStrings = text
        .split('\n')
        .join(' ')
        .match(
          /NET +À +PAYER.*VIREMEN *T(.*)DATE +DE +P *AIEMEN *T(.*)([0-9]{4}).*SOLDE CP/
        )
      if (!matchedStrings) {
        throw new Error('no matched string in pdf')
      }
      const values = matchedStrings
        .slice(1)
        .map(data => data.trim().replace(/\s\s+/g, ' '))

      const amount = parseFloat(
        values
          .shift()
          .replace(/\s/g, '')
          .replace(',', '.')
      )
      const date = moment(values.join(' '), 'DD MMMM YYYY').toDate()
      Object.assign(entry, {
        periodStart: moment(entry.date)
          .startOf('month')
          .format('YYYY-MM-DD'),
        periodEnd: moment(entry.date)
          .endOf('month')
          .format('YYYY-MM-DD'),
        date,
        amount,
        vendor: 'Payfit',
        type: 'pay',
        employer: companyName,
        matchingCriterias: {
          labelRegex: `\\b${companyName}\\b`
        },
        isRefund: true
      })
    }
  })
}

function getTokens({ login, password }) {
  log('info', 'Login...')
  return request({
    uri: 'https://api.payfit.com/auth/signin',
    method: 'POST',
    body: {
      email: login,
      password: password,
      username: login,
      language: 'fr'
    }
  })
    .then(async body => {
      if (body.isMultiFactorRequired) {
        throw new Error(errors.CHALLENGE_ASKED)
      }
      const employee = body.accounts.find(doc => doc.type === 'e')
      let id = employee.id
      let tokens = id.split('/')
      let companyId = tokens[0]
      let employeeId = tokens[1]

      // this is a server side-effect needed for the token to be valid
      await request('https://api.payfit.com/auth/updateCurrentAccount', {
        qs: { companyId, employeeId }
      })

      return { idToken: body.id, employeeId, companyId }
    })
    .catch(err => {
      if (
        err.statusCode === 401 &&
        err.error &&
        err.error.error === 'invalid_password'
      ) {
        throw new Error(errors.LOGIN_FAILED)
      } else {
        throw err
      }
    })
}

async function fetchProfileInfo() {
  return request.post('https://api.payfit.com/hr/user/info')
}

async function fetchPayrolls(tokens) {
  const { employeeId, companyId } = tokens
  log('info', 'Fetching payrolls...')

  const { id } = await request.get(
    'https://api.payfit.com/files/category?name=payslip&country=FR'
  )

  return request.post('https://api.payfit.com/files/files', {
    body: {
      employeeIds: [employeeId],
      categoryIds: [id],
      companyIds: [companyId]
    }
  })
}

function convertPayrollsToCozy(idToken, payrolls) {
  log('info', 'Converting payrolls to cozy...')
  return payrolls.map(({ id, absoluteMonth }) => {
    const date = getDateFromAbsoluteMonth(absoluteMonth)
    const filename = `${formatDate(date, 'YYYY_MM')}.pdf`
    return {
      date: moment(date).format('YYYY-MM-DD'),
      fileurl: `https://api.payfit.com/files/file/${id}?attachment=1`,
      filename,
      vendorId: id
    }
  })
}

// extracted from Payfit front code
function getDateFromAbsoluteMonth(absoluteMonth) {
  return new Date(2015, absoluteMonth - 1)
}
