process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://bb9b62dfb62d4492959a88240d402b21:cac5cbbc6b474095a4754ad2a5f1bf72@sentry.cozycloud.cc/80'

const {
  BaseKonnector,
  log,
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
const crypto = require('crypto')

module.exports = new BaseKonnector(start)

async function start(fields) {
  await this.deactivateAutoSuccessfulLogin()
  const { accounts } = await getTokens.bind(this)(fields)
  await this.notifySuccessfulLogin()

  for (const account of accounts) {
    // only handle employee accounts
    if (account.type !== 'e') continue

    await fetchAccount.bind(this)(fields, account)
  }
}

async function fetchAccount(fields, account) {
  const tokens = account.id.split('/')
  const companyId = tokens[0]
  const employeeId = tokens[1]
  await request('https://api.payfit.com/auth/updateCurrentAccount', {
    qs: { companyId, employeeId }
  })
  const payrolls = await fetchPayrolls({ companyId, employeeId })
  const { companyName } = await fetchProfileInfo()
  const documents = convertPayrollsToCozy(payrolls, companyName)
  moment.locale('fr')
  await this.saveBills(documents, fields, {
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

async function getTokens({ login, password }) {
  log('info', 'Login...')
  try {
    let body = await request.post({
      uri: 'https://api.payfit.com/auth/signin',
      body: {
        s: '',
        email: login,
        password: crypto
          .createHmac('sha256', password)
          .update('')
          .digest('hex'),
        isHashed: true,
        language: 'fr'
      }
    })
    if (body.isMultiFactorRequired) {
      log('info', '2FA detected')
      const code = await this.waitForTwoFaCode({ type: 'sms' })
      body = await request.post({
        uri: 'https://api.payfit.com/auth/signin',
        body: {
          s: '',
          email: login,
          password: crypto
            .createHmac('sha256', password)
            .update('')
            .digest('hex'),
          isHashed: true,
          multiFactorCode: code,
          language: 'fr'
        }
      })
    }
    return body
  } catch (err) {
    if (
      err.statusCode === 401 &&
      err.error &&
      err.error.error === 'invalid_password'
    ) {
      throw new Error(errors.LOGIN_FAILED)
    } else {
      throw err
    }
  }
}

async function fetchProfileInfo() {
  return request.post('https://api.payfit.com/hr/user/info')
}

async function fetchPayrolls({ employeeId, companyId }) {
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

function convertPayrollsToCozy(payrolls, companyName) {
  log('info', 'Converting payrolls to cozy...')
  return payrolls.map(({ id, absoluteMonth }) => {
    const date = getDateFromAbsoluteMonth(absoluteMonth)
    const filename = `${companyName}_${formatDate(date, 'YYYY_MM')}.pdf`
    return {
      date: moment(date).format('YYYY-MM-DD'),
      fileurl: `https://api.payfit.com/files/file/${id}?attachment=1`,
      filename,
      vendorId: id,
      recurrence: 'monthly'
    }
  })
}

// extracted from Payfit front code
function getDateFromAbsoluteMonth(absoluteMonth) {
  return new Date(2015, absoluteMonth - 1)
}
